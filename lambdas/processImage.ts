import { SQSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import path = require("path");
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const tableName = process.env.DYNAMODB_TABLE;
const region = process.env.REGION;
const mailerQueueUrl = process.env.MAILER_QUEUE_URL;

if (!tableName || !region) {
  throw new Error("Environment variables DYNAMODB_TABLE and REGION must be set.");
}

const sqsClient = new SQSClient({ region });

export const handler: SQSHandler = async (event) => {
  const ddbDocClient = createDDbDocClient();
  for (const record of event.Records) {
    try {
      const recordBody = JSON.parse(record.body);
      const snsMessage = JSON.parse(recordBody.Message);

      if (snsMessage.Records) {
        for (const messageRecord of snsMessage.Records) {

          const s3e = messageRecord.s3;
          const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

          // Validate the file type
          const fileExtension = path.extname(srcKey).toLowerCase();
          console.log("File extension:", fileExtension); // Log file extension

          const validExtensions = [".jpeg", ".png"];
          if (!validExtensions.includes(fileExtension)) {
            const errorMessage = `Invalid file type: ${fileExtension}. Only .jpeg and .png files are allowed.`;
            console.error(errorMessage);

            const message = {
              fileName: srcKey,
              errorMessage,
            };

            const params = {
              QueueUrl: mailerQueueUrl,
              MessageBody: JSON.stringify(message),
            };

            const sendMessageCommand = new SendMessageCommand(params);
            await sqsClient.send(sendMessageCommand);
            continue; // Skip processing for invalid files
          }

          const originalFileName = srcKey.split("/").pop(); // Extract file name
          console.log("Original file name:", originalFileName); // Log extracted file name

          if (messageRecord.eventName === "ObjectCreated:Put") {
            await ddbDocClient.send(
              new PutCommand({
                TableName: tableName,
                Item: { fileName: originalFileName },
              })
            );
            console.log(`Successfully added record to DynamoDB for: ${originalFileName}`);
          } else if (messageRecord.eventName === "ObjectRemoved:Delete") {
            await ddbDocClient.send(
              new DeleteCommand({
                TableName: tableName,
                Key: { fileName: originalFileName },
              })
            );
            console.log(`Successfully deleted record from DynamoDB for: ${originalFileName}`);
          } else {
            console.log(`Unhandled event name: ${messageRecord.eventName}`);
          }
        }
      }
    } catch (error) {
      console.error("Error processing record:", JSON.stringify(record, null, 2)); // Log record causing error
      console.error("Error details:", error);
    }
  }
};

function createDDbDocClient() {
  const ddbClient = new DynamoDBClient({ region: process.env.REGION });
  const marshallOptions = {
    convertEmptyValues: true,
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  };
  const unmarshallOptions = {
    wrapNumbers: false,
  };
  const translateConfig = { marshallOptions, unmarshallOptions };
  return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}

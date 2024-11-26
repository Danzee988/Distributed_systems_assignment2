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

  // Log the incoming event for debugging purposes
  for (const record of event.Records) {
    const recordBody = JSON.parse(record.body);
    const snsMessage = JSON.parse(recordBody.Message);

    if (snsMessage.Records) {
      for (const messageRecord of snsMessage.Records) {
        const s3e = messageRecord.s3;
        const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

        // Validate the file type based on the file extension
        const fileExtension = path.extname(srcKey).toLowerCase();
        const validExtensions = [".jpeg", ".png"];

        if (!validExtensions.includes(fileExtension)) {
          const errorMessage = `Invalid file type: ${fileExtension}. Only .jpeg and .png files are allowed.`;
          console.error(errorMessage);

          // Send message to DLQ (mailerQueue) with error details
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

        const originalFileName = srcKey.split("/").pop();  // Extract the file name from the path
        try {
          if (messageRecord.eventName === "ObjectCreated:Put") {
            // Handle file upload (PUT operation)
            await ddbDocClient.send(
              new PutCommand({
                TableName: tableName,
                Item: { fileName: originalFileName },
              })
            );
          } else if (messageRecord.eventName === "ObjectRemoved:Delete") {
            // Handle file deletion (DELETE operation)
            await ddbDocClient.send(
              new DeleteCommand({
                TableName: tableName,
                Key: { fileName: originalFileName },
              })
            );
          } else {
          }
        } catch (error) {
          console.error(`Failed to process image: ${originalFileName}`);
          if (error instanceof Error) {
            console.error("Error Details:", {
              message: error.message,
              stack: error.stack,
              name: error.name,
              originalFileName,
              srcKey,
            });
          } else {
            console.error("Unknown error:", error);
          }
        }
      }
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

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

            const message = {                                           // Prepare message to send to mailer queue
              fileName: srcKey,                                         // File name causing error
              errorMessage,                                             // Error message
            };

            const params = {                                            // Send message to mailer queue
              QueueUrl: mailerQueueUrl,                                 // URL of the mailer queue
              MessageBody: JSON.stringify(message),                     // Message to send to mailer queue
            };

            const sendMessageCommand = new SendMessageCommand(params);
            await sqsClient.send(sendMessageCommand);
            continue; // Skip processing for invalid files
          }

          const originalFileName = srcKey.split("/").pop();             // Extract file name
          console.log("Original file name:", originalFileName);         // Log extracted file name

          if (messageRecord.eventName === "ObjectCreated:Put") {        // Process only for new files
            await ddbDocClient.send(
              new PutCommand({
                TableName: tableName,
                Item: { fileName: originalFileName },
              })
            );
            console.log(`Successfully added record to DynamoDB for: ${originalFileName}`);

          } else if (messageRecord.eventName === "ObjectRemoved:Delete") {// Process only for deleted files
            await ddbDocClient.send(                                     // Delete record from DynamoDB
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
  const ddbClient = new DynamoDBClient({ region: process.env.REGION });         // Create DynamoDB client
  const marshallOptions = {                                                     // Set options to convert class instances to maps
    removeUndefinedValues: true,                                                // Remove undefined values
    convertClassInstanceToMap: true,                                            // Convert class instances to maps
  };
  const unmarshallOptions = {                                                   // Set options to convert maps to class instances
    wrapNumbers: false,                                                         // Do not wrap numbers
  };
  const translateConfig = { marshallOptions, unmarshallOptions };               // Set translation options
  return DynamoDBDocumentClient.from(ddbClient, translateConfig);               // Create DynamoDB Document client
}

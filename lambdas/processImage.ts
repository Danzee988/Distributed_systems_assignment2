import { SQSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, DeleteCommand } from "@aws-sdk/lib-dynamodb";
import path = require("path");
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

const tableName = process.env.DYNAMODB_TABLE;
const region = process.env.REGION;
const mailerQueueAddedUrl = process.env.MAILER_QUEUE_ADDED_URL;
const mailerQueueRejectedUrl = process.env.MAILER_QUEUE_REJECTED_URL;

if (!tableName || !region || !mailerQueueAddedUrl || !mailerQueueRejectedUrl) {
  throw new Error("Environment variables DYNAMODB_TABLE, REGION, MAILER_QUEUE_ADDED_URL, and MAILER_QUEUE_REJECTED_URL must be set.");
}

const sqsClient = new SQSClient({ region });

export const handler: SQSHandler = async (event) => {
  const ddbDocClient = createDDbDocClient();
  
  for (const record of event.Records) {
    try {
      if (!record.body) {
        console.error("Record body is missing");
        continue;
      }

      let recordBody;
      try {
        recordBody = JSON.parse(record.body);
      } catch (e) {
        console.error("Error parsing record body:", e);
        continue; // Skip this record if parsing fails
      }
      const snsMessage = JSON.parse(recordBody.Message);

      if (snsMessage.Records) {
        for (const messageRecord of snsMessage.Records) {
          const s3e = messageRecord.s3;
          const srcKey = decodeURIComponent(s3e.object.key.replace(/\+/g, " "));

          // Validate the file type
          const fileExtension = path.extname(srcKey).toLowerCase();
          console.log("File extension:", fileExtension); // Log file extension

          const validExtensions = [".jpeg", ".png"];
          console.log("Valid extensions:", validExtensions); // Log valid extensions

          if (!validExtensions.includes(fileExtension)) {
            const errorMessage = `Invalid file type: ${fileExtension}. Only .jpeg and .png files are allowed.`;
            console.error(errorMessage);

            // Send message to the rejected mailer queue
            const message = {
              fileName: srcKey,
              errorMessage,
            };

            const params = {
              QueueUrl: mailerQueueRejectedUrl,
              MessageBody: JSON.stringify(message),
            };

            console.log("Sending reject message to:", mailerQueueRejectedUrl);
            console.log("Sending reject message"); // Log file extension
            const sendMessageCommand = new SendMessageCommand(params);
            await sqsClient.send(sendMessageCommand);
            continue; // Skip further processing for invalid files
          }

          const originalFileName = srcKey.split("/").pop(); // Extract file name
          console.log("Original file name:", originalFileName); // Log extracted file name

          if (messageRecord.eventName === "ObjectCreated:Put") {
            // Process only for new files
            await ddbDocClient.send(
              new PutCommand({
                TableName: tableName,
                Item: { fileName: originalFileName },
              })
            );
            console.log(`Successfully added record to DynamoDB for: ${originalFileName}`);

            // Send success notification to added mailer queue
            const successMessage = {
              fileName: originalFileName,
              message: `File '${originalFileName}' was successfully uploaded and processed.`,
            };

            const successParams = {
              QueueUrl: mailerQueueAddedUrl,
              MessageBody: JSON.stringify(successMessage),
            };

            const successCommand = new SendMessageCommand(successParams);
            await sqsClient.send(successCommand);
            console.log(`Success notification sent for file: ${originalFileName}`);
          } else if (messageRecord.eventName === "ObjectRemoved:Delete") {
            // Process only for deleted files
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
    removeUndefinedValues: true,
    convertClassInstanceToMap: true,
  };
  const unmarshallOptions = {
    wrapNumbers: false,
  };
  const translateConfig = { marshallOptions, unmarshallOptions };
  return DynamoDBDocumentClient.from(ddbClient, translateConfig);
}

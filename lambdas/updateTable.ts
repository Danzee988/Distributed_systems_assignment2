import { SQSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ReturnValue } from "@aws-sdk/client-dynamodb"; // Import the enum

// Environment variables
const tableName = process.env.DYNAMODB_TABLE;
const region = process.env.REGION;

if (!tableName || !region) {
  throw new Error("Environment variables DYNAMODB_TABLE and REGION must be set.");
}

// Create DynamoDB Document Client
const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    try {
      // Parse the body and attributes
      const messageBody = JSON.parse(record.body);                                // Parse the message body
      const metadataType = record.messageAttributes.metadata_type?.stringValue;   // Get the metadata type from the message attribute

      const { fileName, value } = messageBody;                                    // Get the fileName and value from the message body

      if (!fileName || !value || !metadataType) {                                 // Check if the message is valid
        console.error("Invalid message format: ", record.body); 
        continue;
      }

      console.log(`Updating metadata for image: ${fileName}, Type: ${metadataType}, Value: ${value}`);

         // Update the DynamoDB table with the metadata
         const updateExpression = `SET ${metadataType} = :value`; // Update the metadata type
         const params = {
           TableName: tableName,                                  // Table name from environment variables
           Key: { fileName },                                     // Primary key
           UpdateExpression: updateExpression,
           ExpressionAttributeValues: {
             ":value": value,
           },
           ReturnValues: ReturnValue.UPDATED_NEW,                 // Return the updated item
         };

      const response = await ddbDocClient.send(new UpdateCommand(params));
      console.log("DynamoDB Update Response: ", response);
    } catch (error) {
      console.error("Error processing record: ", error);
    }
  }
};

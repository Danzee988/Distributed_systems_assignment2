import { SQSHandler } from "aws-lambda";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ReturnValue } from "@aws-sdk/client-dynamodb";

const tableName = process.env.DYNAMODB_TABLE;
const region = process.env.REGION;

if (!tableName || !region) {
  throw new Error("Environment variables DYNAMODB_TABLE and REGION must be set.");
}

const ddbDocClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    try {
      // 
      const snsMessage = JSON.parse(record.body); // Parse the outer body
      const messageBody = JSON.parse(snsMessage.Message); // Parse the inner "Message" JSON

      // 
      const { fileName, value, date, name } = messageBody;

      const metadataDate = date.toString();
      const metadataValue = value.toString();
      const metadataName = name.toString();

      // 
      if (!fileName || !value || !date || !name ) {
        console.error("Invalid message format: Missing required fields", {
          fileName,
          value,
          date,
          name,
        });
        continue; // Skip processing this record
      }

      console.log(`Updating metadata for image: ${fileName}, Type: ${value}, Value: ${value}`);

      // Step 5: Construct the DynamoDB UpdateCommand parameters
      const updateExpression = `SET #caption = :value, #addedDate = :date, #photographerName = :name`;
      const params = {
        TableName: tableName,
        Key: { fileName }, // Use fileName as the primary key
        UpdateExpression: updateExpression,
        ExpressionAttributeNames: {
          "#caption": "Caption", // Alias for the attribute "Caption"
          "#addedDate": "AddedDate", // Alias for the attribute "AddedDate"
          "#photographerName": "PhotographerName", // Alias for the attribute "PhotographerName"
        },
        ExpressionAttributeValues: {
          ":value": metadataValue, // Actual value from the message
          ":date": metadataDate,
          ":name": metadataName,
        },
        ReturnValues: ReturnValue.UPDATED_NEW,
      };

      // Step 6: Execute the DynamoDB UpdateCommand
      const response = await ddbDocClient.send(new UpdateCommand(params));
      console.log("DynamoDB Update Response: ", response);
    } catch (error) {
      console.error("Error processing record: ", error);
    }
  }
};

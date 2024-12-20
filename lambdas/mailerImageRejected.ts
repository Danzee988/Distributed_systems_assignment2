import { SQSHandler } from "aws-lambda";
import { SES_EMAIL_FROM, SES_EMAIL_TO, SES_REGION } from "../env";
import {
  SESClient,
  SendEmailCommand,
  SendEmailCommandInput,
} from "@aws-sdk/client-ses";

// Ensure required environment variables are set
if (!SES_EMAIL_TO || !SES_EMAIL_FROM || !SES_REGION) {
  throw new Error(
    "Please add the SES_EMAIL_TO, SES_EMAIL_FROM and SES_REGION environment variables in an env.js file located in the root directory"
  );
}

type ContactDetails = { 
  name: string;
  email: string;
  message: string;
};

const client = new SESClient({ region: SES_REGION });                   // Create an SES client

export const handler: SQSHandler = async (event: any) => {
  console.log("Event: ", JSON.stringify(event));

  // Loop through SQS records (messages from DLQ)
  for (const record of event.Records) {                                // Loop through each record
    try {
      // Parse the SQS message body
      const snsMessage = JSON.parse(record.body);                     // Parse the outer body
      const { fileName, errorMessage } = snsMessage;                  // Extract the file name and error message

      // Create email content
      const { name, email, message }: ContactDetails = {              // Prepare email content
        name: "The Photo Album",
        email: SES_EMAIL_FROM,
        message: `Your image failed validation. Error: ${errorMessage}. The image file is: ${fileName}. Please review the image or try uploading a different one.`,
      };

      console.log(`message body is: `, message);   // Log the message body
      // Prepare email parameters
      const params = sendEmailParams({ name, email, message });       // Prepare email parameters

      // Send the rejection email
      await client.send(new SendEmailCommand(params));                // Send the email

      console.log(`Rejection email sent for image: ${fileName}`);
    } catch (error) {
      console.error("Error processing DLQ message:", error);
    }
  }
};

// Function to prepare the email parameters
function sendEmailParams({ name, email, message }: ContactDetails): SendEmailCommandInput {
  console.log("Sending email to:", SES_EMAIL_TO);                     // Log the recipient email address
  const parameters: SendEmailCommandInput = {                       // Prepare email parameters
    Destination: {                                                  // Destination email address
      ToAddresses: [SES_EMAIL_TO],                                  // Recipient email address
    },
    Message: {
      Body: {
        Html: {
          Charset: "UTF-8",
          Data: getHtmlContent({ name, email, message }),
        },
      },
      Subject: {
        Charset: "UTF-8",
        Data: `Image Upload Failure - ${name}`,
      },
    },
    Source: SES_EMAIL_FROM,
  };
  return parameters;
}

// Function to generate HTML content for the email body
function getHtmlContent({ name, email, message }: ContactDetails): string {
  const htmlContent = `
    <html>
      <body>
        <h2>Sent from: </h2>
        <ul>
          <li style="font-size:18px">👤 <b>${name}</b></li>
          <li style="font-size:18px">✉️ <b>${email}</b></li>
        </ul>
        <p style="font-size:18px">${message}</p>
      </body>
    </html>
  `;
  
  console.log("Generated HTML content:", htmlContent);  // Log the final HTML content
  return htmlContent;
}


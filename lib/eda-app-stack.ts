import * as cdk from "aws-cdk-lib";
import * as lambdanode from "aws-cdk-lib/aws-lambda-nodejs";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as s3n from "aws-cdk-lib/aws-s3-notifications";
import * as events from "aws-cdk-lib/aws-lambda-event-sources";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subs from "aws-cdk-lib/aws-sns-subscriptions";
import * as iam from "aws-cdk-lib/aws-iam";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";

import { Construct } from "constructs";
export class EDAAppStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const imagesBucket = new s3.Bucket(this, "images", {                          // Create an S3 bucket
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

  // Creating image table------------------------------------------------------------ 
    const imagesTable = new dynamodb.Table(this, "ImageTable", {                  // Create a DynamoDB table
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,                          // Set billing mode to pay-per-request
      partitionKey: { name: "fileName", type: dynamodb.AttributeType.STRING },    // Set the partition key
      removalPolicy: cdk.RemovalPolicy.DESTROY,                                   // Set removal policy to destroy
      tableName: "Images",                                                        // Set the table name
    }); 

  // Integration infrastructure------------------------------------------------------
   // Create the SQS queues
  const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {           // Create an SQS queue
    receiveMessageWaitTime: cdk.Duration.seconds(5),                             // Set the receive message wait time
  });

  const metadataQueue = new sqs.Queue(this, "MetadataUpdatesQueue", {          
    receiveMessageWaitTime: cdk.Duration.seconds(5), 
  });

  const mailerQueueAdded = new sqs.Queue(this, "MailerQueueAdded", {
    receiveMessageWaitTime: cdk.Duration.seconds(10),
  });

  const mailerQueueRejected = new sqs.Queue(this, "MailerQueueRejected", {
    receiveMessageWaitTime: cdk.Duration.seconds(10),
  });

  // SNS topics
  const newImageTopic = new sns.Topic(this, "NewImageTopic", {                  // Create an SNS topic
    displayName: "New Image topic",                                             // Set the display name
  }); 

  const updateImageTopic = new sns.Topic(this, "UpdateImageTopic", {
    displayName: "Update Image topic",
  });

  // Lambda functions----------------------------------------------------------------
  const processImageFn = new lambdanode.NodejsFunction(                       // Create a Lambda function
    this,
    "ProcessImageFn",
    {
      runtime: lambda.Runtime.NODEJS_18_X,                                    // Set the runtime
      entry: `${__dirname}/../lambdas/processImage.ts` ,                      // Set the entry file
      timeout: cdk.Duration.seconds(15),                                      // Set the timeout
      memorySize: 128,                                                        // Set the memory size
      deadLetterQueue: mailerQueueRejected,                                   // Set the dead letter queue
      deadLetterQueueEnabled: true,                                           // Enable the dead letter queue
      environment: {
        DYNAMODB_TABLE: imagesTable.tableName,                                // Set the environment variables
        REGION: this.region,                                                  // Set the region
        MAILER_QUEUE_ADDED_URL: mailerQueueAdded.queueUrl,                    // Set the added mailer queue URL
        MAILER_QUEUE_REJECTED_URL: mailerQueueRejected.queueUrl,              // Set the rejected mailer queue URL
      },
    }
  );

  const mailerImageAddedFn = new lambdanode.NodejsFunction(this, "MailerImageAddedFn", {
    runtime: lambda.Runtime.NODEJS_16_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/mailerImageAdded.ts`,
  });

  const mailerImageRejectedFn = new lambdanode.NodejsFunction(this, "MailerImageRejectedFn", {
    runtime: lambda.Runtime.NODEJS_16_X,
    memorySize: 1024,
    timeout: cdk.Duration.seconds(3),
    entry: `${__dirname}/../lambdas/mailerImageRejected.ts`,
  });

  const updateTableFn = new lambdanode.NodejsFunction(this, "UpdateTableFn", {
    runtime: lambda.Runtime.NODEJS_18_X,
    entry: `${__dirname}/../lambdas/updateTable.ts`,
    timeout: cdk.Duration.seconds(10),
    environment: {
      DYNAMODB_TABLE: imagesTable.tableName,
      REGION: this.region,
    },
  });

  // S3 --> SQS-------------------------------------------------------------------
  imagesBucket.addEventNotification(                                          // Add an event notification
    s3.EventType.OBJECT_CREATED,                                              // Set the event type
    new s3n.SnsDestination(newImageTopic)                                     // Set the destination
  );

  imagesBucket.addEventNotification(
    s3.EventType.OBJECT_REMOVED,
    new s3n.SnsDestination(newImageTopic)  // Changed
  );

  newImageTopic.addSubscription(
    new subs.SqsSubscription(imageProcessQueue)
  );

  newImageTopic.addSubscription(
    new subs.SqsSubscription(mailerQueueAdded)
  );

  newImageTopic.addSubscription(
    new subs.SqsSubscription(mailerQueueRejected)
  );

  updateImageTopic.addSubscription(
    new subs.SqsSubscription(metadataQueue)
  )

 // SQS --> Lambda----------------------------------------------------------------
  const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  });

  const newImageMailEventSourceAdded = new events.SqsEventSource(mailerQueueAdded, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  }); 

  const newImageMailEventSourceRejected = new events.SqsEventSource(mailerQueueRejected, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  });

  updateTableFn.addEventSource(new events.SqsEventSource(metadataQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  }));

  processImageFn.addEventSource(newImageEventSource);
  mailerImageAddedFn.addEventSource(newImageMailEventSourceAdded);
  mailerImageRejectedFn.addEventSource(newImageMailEventSourceRejected);

  // Permissions-------------------------------------------------------------------
  imagesTable.grantWriteData(processImageFn);
  imagesBucket.grantRead(processImageFn);
  imagesTable.grantWriteData(updateTableFn);

  mailerImageAddedFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );

  mailerImageRejectedFn.addToRolePolicy(
    new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        "ses:SendEmail",
        "ses:SendRawEmail",
        "ses:SendTemplatedEmail",
      ],
      resources: ["*"],
    })
  );

  // Environment variables----------------------------------------------------------
  processImageFn.addEnvironment('DYNAMODB_TABLE', imagesTable.tableName);
  processImageFn.addEnvironment('REGION', this.region);
  processImageFn.addEnvironment('MAILER_QUEUE_ADDED_URL', mailerQueueAdded.queueUrl);
  processImageFn.addEnvironment('MAILER_QUEUE_REJECTED_URL', mailerQueueRejected.queueUrl);


  // Output------------------------------------------------------------------------
  
  new cdk.CfnOutput(this, "bucketName", {
    value: imagesBucket.bucketName,
  });
  }
}

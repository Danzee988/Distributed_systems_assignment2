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

    const imagesBucket = new s3.Bucket(this, "images", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      publicReadAccess: false,
    });

  // Creating image table------------------------------------------------------------ 
    const imagesTable = new dynamodb.Table(this, "ImageTable", {
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: "fileName", type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      tableName: "Images",
    });

  // Integration infrastructure------------------------------------------------------

  const imageProcessQueue = new sqs.Queue(this, "img-created-queue", {
    receiveMessageWaitTime: cdk.Duration.seconds(5),
  });

  // Create the SQS queue
  const metadataQueue = new sqs.Queue(this, "MetadataUpdatesQueue", {
    receiveMessageWaitTime: cdk.Duration.seconds(5),
  });

  const newImageTopic = new sns.Topic(this, "NewImageTopic", {
    displayName: "New Image topic",
  }); 

  const updateImageTopic = new sns.Topic(this, "UpdateImageTopic", {
    displayName: "Update Image topic",
  });

  const mailerQ = new sqs.Queue(this, "mailer-queue", {
    receiveMessageWaitTime: cdk.Duration.seconds(10),
  });

  // Lambda functions----------------------------------------------------------------

  const processImageFn = new lambdanode.NodejsFunction(
    this,
    "ProcessImageFn",
    {
      runtime: lambda.Runtime.NODEJS_18_X,
      entry: `${__dirname}/../lambdas/processImage.ts`,
      timeout: cdk.Duration.seconds(15),
      memorySize: 128,
      deadLetterQueue: mailerQ, 
      deadLetterQueueEnabled: true,
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
  imagesBucket.addEventNotification(
    s3.EventType.OBJECT_CREATED,
    new s3n.SnsDestination(newImageTopic)  // Changed
  );

  newImageTopic.addSubscription(
    new subs.SqsSubscription(imageProcessQueue)
  );

  newImageTopic.addSubscription(
    new subs.SqsSubscription(mailerQ)
  );

  updateImageTopic.addSubscription(
    new subs.SqsSubscription(metadataQueue)
  )

 // SQS --> Lambda----------------------------------------------------------------
  const newImageEventSource = new events.SqsEventSource(imageProcessQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  });

  const newImageMailEventSource = new events.SqsEventSource(mailerQ, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  }); 

  updateTableFn.addEventSource(new events.SqsEventSource(metadataQueue, {
    batchSize: 5,
    maxBatchingWindow: cdk.Duration.seconds(5),
  }));

  processImageFn.addEventSource(newImageEventSource);
  mailerImageAddedFn.addEventSource(newImageMailEventSource);
  mailerImageRejectedFn.addEventSource(newImageMailEventSource);

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

  // Output------------------------------------------------------------------------
  
  new cdk.CfnOutput(this, "bucketName", {
    value: imagesBucket.bucketName,
  });
  }
}

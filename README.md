# 📸⚙️📧 Distributed Image Processing & Notification System

A distributed system application for image processing, email notifications, and table updates, built in phases. This project demonstrates asynchronous processing, fault-tolerant mailer functionality, and image pipeline integration.

## 🎥 Demo
[![Demo Video](https://img.youtube.com/vi/AYByBNqksrs/0.jpg)](https://AYByBNqksrs)

## 🚀 Project Overview

- Listens to S3 upload events via SNS and SQS.
- Validates uploaded images (accepts only `.jpeg` and `.png`).
- Stores metadata in DynamoDB.
- Sends notification emails using Amazon SES.
- Handles rejected uploads with detailed email alerts.

## 🛠️ Setup and Environment Variables

Make sure to configure the following environment variables in your `.env` or `env.js` file located in the project root:

| Variable                | Description                              |
|-------------------------|------------------------------------------|
| `SES_EMAIL_FROM`        | Email address to send notifications from |
| `SES_EMAIL_TO`          | Email address to receive notifications    |
| `SES_REGION`            | AWS SES region (e.g., `us-east-1`)        |
| `DYNAMODB_TABLE`        | DynamoDB table name for storing metadata  |
| `REGION`                | AWS region for DynamoDB and SQS            |
| `MAILER_QUEUE_ADDED_URL`| SQS queue URL for successful uploads       |
| `MAILER_QUEUE_REJECTED_URL`| SQS queue URL for rejected uploads     |


## 📥 Lambda Handlers

### 1. ✅ Handle Valid Uploads and Send Confirmation Email
- Parses S3 event notifications from SNS via SQS.
- Sends an email notifying the user about the successful upload.
- Saves file info to DynamoDB.
- Sends success message to the mailer queue.

### 2. ❌ Handle Rejected Uploads and Send Failure Email
- Listens to SQS dead-letter queue for rejected uploads.
- Sends rejection emails with detailed error messages.
  
### 3. 🗃️ Manage DynamoDB Records
- Adds new records when files are uploaded.
- Deletes records when files are removed.
- Updates metadata fields such as caption, added date, and photographer name.

## 🔧 How to Run
1. **Install dependencies:**
    - ```npm install```
2. **Set environment variables in .env or env.js.**
3. **Deploy Lambda functions using your preferred AWS deployment method (SAM, Serverless Framework, etc.).**
4. **Configure S3 bucket notifications to SNS, SNS to SQS, and setup DLQ for rejections.**
5. **Test by uploading images to your S3 bucket.**

## 📝 Notes
- Only .jpeg and .png files are allowed.
- Errors during processing will be logged and rejected uploads will trigger emails.
- Make sure SES is verified for the sender and receiver emails.
- DynamoDB table must have fileName as the primary key.



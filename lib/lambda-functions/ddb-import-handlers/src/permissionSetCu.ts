/*
Objective: Implement event notification handler for permission set objects s3clientObject path
Trigger source: permission set s3clientObject path object notification for
both created and change type events
- Schema validation of the file name
- Upsert in permission set DDB table parsing the file name
*/

// Environment configuration read
const { DdbTable, errorNotificationsTopicArn, AWS_REGION } = process.env;

// Lambda and other types import
// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  GetObjectCommand,
  GetObjectCommandOutput,
  S3Client,
} from "@aws-sdk/client-s3";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
//Import validator function and dependencies
import Ajv from "ajv";
import { S3Event, S3EventRecord } from "aws-lambda";
import { readFileSync } from "fs";
import { join } from "path";
import { Readable } from "stream";
//Import helper utilities and interfaces
import {
  CreateUpdatePermissionSetPayload,
  ErrorMessage,
} from "../../helpers/src/interfaces";
import {
  imperativeParseJSON,
  JSONParserError,
} from "../../helpers/src/payload-validator";
import { removeEmpty, streamToString } from "../../helpers/src/utilities";

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION });
const s3clientObject = new S3Client({ region: AWS_REGION });

// Validator object initialisation
const ajv = new Ajv({ allErrors: true });
const createUpdateSchemaDefinition = JSON.parse(
  readFileSync(
    join(
      "/opt",
      "nodejs",
      "payload-schema-definitions",
      "PermissionSet-createUpdateAPI.json"
    )
  )
    .valueOf()
    .toString()
);
const createUpdateValidate = ajv.compile(createUpdateSchemaDefinition);

//Error notification
const errorMessage: ErrorMessage = {
  Subject: "Error Processing Permission Set create/update via S3 Interface",
};

export const handler = async (event: S3Event) => {
  await Promise.all(
    event.Records.map(async (record: S3EventRecord) => {
      try {
        // Get original text from object in incoming event
        const originalText: GetObjectCommandOutput = await s3clientObject.send(
          new GetObjectCommand({
            Bucket: record.s3.bucket.name,
            Key: record.s3.object.key,
          })
        );
        const jsonData = JSON.parse(
          await streamToString(originalText.Body as Readable)
        );
        const payload = <CreateUpdatePermissionSetPayload>(
          imperativeParseJSON(jsonData, createUpdateValidate)
        );
        const upsertData = removeEmpty(payload);
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: DdbTable,
            Item: {
              ...upsertData,
            },
          })
        );
      } catch (err) {
        if (err instanceof JSONParserError) {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Message: JSON.stringify({
                ...errorMessage,
                eventDetail: record,
                errorDetails: { errors: err.errors },
              }),
            })
          );
          console.error(
            `Error processing Permission set create/update through S3 interface with schema errors: ${JSON.stringify(
              err.errors
            )}`
          );
        } else {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Message: JSON.stringify({
                ...errorMessage,
                eventDetail: record,
                errorDetails: `Error processing permissionSet create/update via S3 interface with exception: ${err}`,
              }),
            })
          );
          console.error(
            `Error processing permissionSet create/update via S3 interface with exception: ${JSON.stringify(
              err
            )}`
          );
        }
      }
    })
  );
};

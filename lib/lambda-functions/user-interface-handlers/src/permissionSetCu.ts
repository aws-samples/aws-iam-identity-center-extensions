/**
 * Objective: Implement event notification handler for permission set objects
 * s3clientObject path Trigger source: permission set s3clientObject path object
 * notification for both created and change type events
 *
 * - Schema validation of the file name
 * - Upsert in permission set DDB table parsing the file name
 */

// Environment configuration read
const {
  DdbTable,
  errorNotificationsTopicArn,
  AWS_REGION,
  permissionSetProcessingTopicArn,
} = process.env;

// Lambda and other types import
// SDK and third party client imports
import {
  DynamoDBClient,
  DynamoDBServiceException,
} from "@aws-sdk/client-dynamodb";
import {
  GetObjectCommand,
  GetObjectCommandOutput,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import {
  PublishCommand,
  SNSClient,
  SNSServiceException,
} from "@aws-sdk/client-sns";
import {
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
//Import validator function and dependencies
import Ajv from "ajv";
import { S3Event, S3EventRecord } from "aws-lambda";
import { readFileSync } from "fs";
import { join } from "path";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
//Import helper utilities and interfaces
import {
  CreateUpdatePermissionSetPayload,
  requestStatus,
} from "../../helpers/src/interfaces";
import {
  imperativeParseJSON,
  JSONParserError,
} from "../../helpers/src/payload-validator";
import {
  constructExceptionMessage,
  logger,
  removeEmpty,
  streamToString,
} from "../../helpers/src/utilities";
// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });
const s3clientObject = new S3Client({ region: AWS_REGION, maxAttempts: 2 });

// Validator object initialisation
const ajv = new Ajv({ allErrors: true });
const createUpdateSchemaDefinition = JSON.parse(
  readFileSync(
    join(
      "/opt",
      "nodejs",
      "payload-schema-definitions",
      "PermissionSet-createUpdateS3.json"
    )
  )
    .valueOf()
    .toString()
);
const createUpdateValidate = ajv.compile(createUpdateSchemaDefinition);

export const handler = async (event: S3Event) => {
  await Promise.all(
    event.Records.map(async (record: S3EventRecord) => {
      try {
        const requestId = uuidv4().toString();
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
        const payload: CreateUpdatePermissionSetPayload = imperativeParseJSON(
          jsonData,
          createUpdateValidate
        );
        const upsertData = removeEmpty(payload);
        const fetchPermissionSet: GetCommandOutput =
          await ddbDocClientObject.send(
            new GetCommand({
              TableName: DdbTable,
              Key: {
                permissionSetName: upsertData.permissionSetName,
              },
            })
          );
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: DdbTable,
            Item: {
              ...upsertData,
            },
          })
        );
        if (fetchPermissionSet.Item) {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: permissionSetProcessingTopicArn + "",
              Message: JSON.stringify({
                requestId: requestId,
                action: "update",
                permissionSetName: upsertData.permissionSetName,
                oldPermissionSetData: fetchPermissionSet.Item,
              }),
            })
          );
        } else {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: permissionSetProcessingTopicArn + "",
              Message: JSON.stringify({
                requestId: requestId,
                action: "create",
                permissionSetName: upsertData.permissionSetName,
              }),
            })
          );
        }

        logger({
          handler: "userInterface-permissionSetS3CreateUpdate",
          logMode: "info",
          relatedData: upsertData.permissionSetName,
          requestId: requestId,
          status: requestStatus.InProgress,
          statusMessage: `Permission Set operation is being processed`,
        });
      } catch (err) {
        if (err instanceof JSONParserError) {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Subject:
                "Exception in permission set processing through S3 interface",

              Message: constructExceptionMessage(
                "permissionSetCu.ts",
                "Schema validation exception",
                "Provided permission set S3 file does not pass the schema validation",
                JSON.stringify(err.errors)
              ),
            })
          );
          logger({
            handler: "permissionSetCu.ts",
            logMode: "error",
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessage(
              "permissionSetCu.ts",
              "Schema validation exception",
              "Provided permission set S3 file does not pass the schema validation",
              JSON.stringify(err.errors)
            ),
          });
        } else if (
          err instanceof S3ServiceException ||
          err instanceof DynamoDBServiceException ||
          err instanceof SNSServiceException
        ) {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Subject:
                "Exception in permission set processing through S3 interface",

              Message: constructExceptionMessage(
                "permissionSetCu.ts",
                err.name,
                err.message,
                ""
              ),
            })
          );
          logger({
            handler: "permissionSetCu.ts",
            logMode: "error",
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessage(
              "permissionSetCu.ts",
              err.name,
              err.message,
              ""
            ),
          });
        } else {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Subject:
                "Exception in permission set processing through S3 interface",

              Message: constructExceptionMessage(
                "permissionSetCu.ts",
                "Unhandled exception",
                JSON.stringify(err),
                ""
              ),
            })
          );
          logger({
            handler: "userInterface-permissionSetS3CreateUpdate",
            logMode: "error",
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessage(
              "permissionSetCu.ts",
              "Unhandled exception",
              JSON.stringify(err),
              ""
            ),
          });
        }
      }
    })
  );
};

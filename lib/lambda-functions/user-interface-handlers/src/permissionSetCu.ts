/**
 * Objective: Implement event notification handler for permission set objects
 * s3clientObject path Trigger source: permission set s3clientObject path object
 * notification for both created and change type events
 *
 * - Schema validation of the file name
 * - Upsert in permission set DDB table parsing the file name
 */

const {
  DdbTable,
  errorNotificationsTopicArn,
  AWS_REGION,
  permissionSetProcessingTopicArn,
  functionLogMode,
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;
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
import Ajv from "ajv";
import { S3Event, S3EventRecord } from "aws-lambda";
import { readFileSync } from "fs";
import { join } from "path";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import {
  CreateUpdatePermissionSetPayload,
  logModes,
  requestStatus,
} from "../../helpers/src/interfaces";
import {
  imperativeParseJSON,
  JSONParserError,
} from "../../helpers/src/payload-validator";
import {
  constructExceptionMessage,
  constructExceptionMessageforLogger,
  logger,
  removeEmpty,
  streamToString,
} from "../../helpers/src/utilities";

const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });
const s3clientObject = new S3Client({ region: AWS_REGION, maxAttempts: 2 });

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
const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
let permissionSetFileName = "";
const messageSubject =
  "Exception in permission set create/update operation through S3 interface";

export const handler = async (event: S3Event) => {
  await Promise.all(
    event.Records.map(async (record: S3EventRecord) => {
      const requestId = uuidv4().toString();
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          status: requestStatus.InProgress,
          statusMessage: `Permission Set create/update operation started`,
        },
        functionLogMode
      );
      try {
        const originalText: GetObjectCommandOutput = await s3clientObject.send(
          new GetObjectCommand({
            Bucket: record.s3.bucket.name,
            Key: record.s3.object.key.replace(/\+/g, " "),
          })
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Fetched S3 file content from permission_sets location - ${record.s3.bucket.name}/${record.s3.object.key}`,
          },
          functionLogMode
        );
        permissionSetFileName = record.s3.object.key.replace(/\+/g, " ");
        const jsonData = JSON.parse(
          await streamToString(originalText.Body as Readable)
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Parsed file content successfuly`,
          },
          functionLogMode
        );
        const payload: CreateUpdatePermissionSetPayload = imperativeParseJSON(
          jsonData,
          createUpdateValidate
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Completed imperative parsing to handle any malformed/null JSON values`,
          },
          functionLogMode
        );
        const upsertData = removeEmpty(payload);
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            relatedData: upsertData.permissionSetName,
            statusMessage: `Removed empty values from permission set JSON`,
          },
          functionLogMode
        );
        const fetchPermissionSet: GetCommandOutput =
          await ddbDocClientObject.send(
            new GetCommand({
              TableName: DdbTable,
              Key: {
                permissionSetName: upsertData.permissionSetName,
              },
            })
          );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            relatedData: upsertData.permissionSetName,
            statusMessage: `Checked if the permission set already exists in the solution to determine create/update operation`,
          },
          functionLogMode
        );
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: DdbTable,
            Item: {
              ...upsertData,
            },
          })
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.InProgress,
            relatedData: upsertData.permissionSetName,
            statusMessage: `Processed upsert operation successfully`,
          },
          functionLogMode
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
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              status: requestStatus.InProgress,
              relatedData: upsertData.permissionSetName,
              statusMessage: `Determined the operation is update type, posting to permissionSetProcessor topic`,
            },
            functionLogMode
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
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              status: requestStatus.InProgress,
              relatedData: upsertData.permissionSetName,
              statusMessage: `Determined the operation is create type, posting to permissionSetProcessor topic`,
            },
            functionLogMode
          );
        }
      } catch (err) {
        if (err instanceof JSONParserError) {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Subject: messageSubject,
              Message: constructExceptionMessage(
                requestId,
                handlerName,
                "Schema validation exception",
                `Provided permission set ${permissionSetFileName} S3 file does not pass the schema validation`,
                JSON.stringify(err.errors)
              ),
            })
          );
          logger({
            handler: handlerName,
            requestId: requestId,
            logMode: logModes.Exception,
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessageforLogger(
              requestId,
              "Schema validation exception",
              `Provided permission set ${permissionSetFileName} S3 file does not pass the schema validation`,
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
              Subject: messageSubject,
              Message: constructExceptionMessage(
                requestId,
                handlerName,
                err.name,
                err.message,
                permissionSetFileName
              ),
            })
          );
          logger({
            handler: handlerName,
            requestId: requestId,
            logMode: logModes.Exception,
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessageforLogger(
              requestId,
              err.name,
              err.message,
              permissionSetFileName
            ),
          });
        } else {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Subject: messageSubject,
              Message: constructExceptionMessage(
                requestId,
                handlerName,
                "Unhandled exception",
                JSON.stringify(err),
                permissionSetFileName
              ),
            })
          );
          logger({
            handler: handlerName,
            requestId: requestId,
            logMode: logModes.Exception,
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessageforLogger(
              requestId,
              "Unhandled exception",
              JSON.stringify(err),
              permissionSetFileName
            ),
          });
        }
      }
    })
  );
};

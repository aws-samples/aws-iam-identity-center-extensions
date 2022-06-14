/**
 * Objective: Implement lambda proxy for permission set importer API Trigger
 * source: Permission set API
 *
 * - Schema validation of the payload
 * - Upsert / delete in permission sets DDB table depending on the operation
 */

// Environment configuration read
const {
  linksTable,
  AWS_REGION,
  artefactsBucketName,
  DdbTable,
  permissionSetProcessingTopicArn,
} = process.env;

// Lambda types import
// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import {
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
  PutCommand,
  QueryCommand,
  QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
//Import validator function and dependencies
import Ajv from "ajv";
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CreateUpdatePermissionSetPayload,
  DeletePermissionSetPayload,
  requestStatus,
} from "../../helpers/src/interfaces";
//Import helper utilities and interfaces
import {
  imperativeParseJSON,
  JSONParserError,
} from "../../helpers/src/payload-validator";
import { v4 as uuidv4 } from "uuid";
import { logger } from "../../helpers/src/utilities";
// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const s3clientObject = new S3Client({ region: AWS_REGION, maxAttempts: 2 });
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });

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
const deleteSchemaDefinition = JSON.parse(
  readFileSync(
    join(
      "/opt",
      "nodejs",
      "payload-schema-definitions",
      "PermissionSet-DeleteAPI.json"
    )
  )
    .valueOf()
    .toString()
);
const deleteValidate = ajv.compile(deleteSchemaDefinition);

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  if (event.body !== null && event.body !== undefined) {
    try {
      const body = JSON.parse(event.body);
      const requestId = uuidv4().toString();
      if (body.action === "create" || body.action === "update") {
        const payload: CreateUpdatePermissionSetPayload = imperativeParseJSON(
          event.body,
          createUpdateValidate
        );
        await s3clientObject.send(
          new PutObjectCommand({
            Bucket: artefactsBucketName,
            Key: `permission_sets/${payload.permissionSetData.permissionSetName}.json`,
            Body: JSON.stringify(payload.permissionSetData),
            ServerSideEncryption: "AES256",
          })
        );
        const fetchPermissionSet: GetCommandOutput =
          await ddbDocClientObject.send(
            new GetCommand({
              TableName: DdbTable,
              Key: {
                permissionSetName: payload.permissionSetData.permissionSetName,
              },
            })
          );
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: DdbTable,
            Item: {
              ...payload.permissionSetData,
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
                permissionSetName: payload.permissionSetData.permissionSetName,
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
                permissionSetName: payload.permissionSetData.permissionSetName,
              }),
            })
          );
        }

        logger({
          handler: "userInterface-permissionSetApi",
          logMode: "info",
          relatedData: payload.permissionSetData.permissionSetName,
          requestId: requestId,
          status: requestStatus.InProgress,
          statusMessage: `Permission Set ${payload.action} operation is being processed`,
        });
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Permission Set ${payload.action} operation is being processed`,
            requestId: requestId,
          }),
        };
      } else if (body.action === "delete") {
        const payload: DeletePermissionSetPayload = imperativeParseJSON(
          event.body,
          deleteValidate
        );
        const relatedLinks: QueryCommandOutput = await ddbDocClientObject.send(
          // QueryCommand is a pagniated call, however the logic requires
          // checking only if the result set is greater than 0
          new QueryCommand({
            TableName: linksTable,
            IndexName: "permissionSetName",
            KeyConditionExpression: "#permissionSetName = :permissionSetName",
            ExpressionAttributeNames: {
              "#permissionSetName": "permissionSetName",
            },
            ExpressionAttributeValues: {
              ":permissionSetName": payload.permissionSetData.permissionSetName,
            },
          })
        );

        if (relatedLinks.Items?.length !== 0) {
          logger({
            handler: "userInterface-permissionSetApi",
            logMode: "warn",
            relatedData: payload.permissionSetData.permissionSetName,
            requestId: requestId,
            status: requestStatus.Aborted,
            statusMessage: `Permission Set ${payload.action} operation aborted as there are existing account assignments referencing the permission set`,
          });
          return {
            statusCode: 400,
            body: JSON.stringify({
              message: `Permission Set ${payload.action} operation aborted as there are existing account assignments referencing the permission set`,
              requestId: requestId,
            }),
          };
        } else {
          await s3clientObject.send(
            new DeleteObjectCommand({
              Bucket: artefactsBucketName,
              Key: `permission_sets/${payload.permissionSetData.permissionSetName}.json`,
            })
          );
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: permissionSetProcessingTopicArn + "",
              Message: JSON.stringify({
                requestId: requestId,
                action: payload.action,
                permissionSetName: payload.permissionSetData.permissionSetName,
              }),
            })
          );
          logger({
            handler: "userInterface-permissionSetApi",
            logMode: "info",
            relatedData: payload.permissionSetData.permissionSetName,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Permission Set ${payload.action} operation is being processed`,
          });
          return {
            statusCode: 200,
            body: JSON.stringify({
              message: `Permission Set ${payload.action} operation is being processed`,
              requestId: requestId,
            }),
          };
        }
      } else {
        logger({
          handler: "userInterface-permissionSetApi",
          logMode: "error",
          requestId: requestId,
          status: requestStatus.FailedWithError,
          statusMessage: `Permission Set operation failed due to invalid action - ${body.action}`,
        });
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: `Permission Set operation failed due to invalid action - ${body.action}`,
            requestId: requestId,
          }),
        };
      }
    } catch (err) {
      if (err instanceof JSONParserError) {
        logger({
          handler: "userInterface-permissionSetApi",
          logMode: "error",
          status: requestStatus.FailedWithException,
          statusMessage: `Permission Set operation failed due to schema validation errors:${JSON.stringify(
            err.errors
          )}`,
        });
        return {
          statusCode: 500,
          body: JSON.stringify({ errors: err.errors }),
        };
      } else {
        logger({
          handler: "userInterface-permissionSetApi",
          logMode: "error",
          status: requestStatus.FailedWithException,
          statusMessage: `Permission Set operation failed due to exception:${JSON.stringify(
            err
          )}`,
        });
        return {
          statusCode: 500,
          body: JSON.stringify({
            message: `Exception while processing the call ${err}`,
          }),
        };
      }
    }
  } else {
    logger({
      handler: "userInterface-permissionSetApi",
      logMode: "error",
      status: requestStatus.FailedWithException,
      statusMessage: `Permission Set operation failed due to invalid message body`,
    });
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Invalid message body provided",
      }),
    };
  }
};

/**
 * Objective: Implement lambda proxy for permission set importer API Trigger
 * source: Permission set API
 *
 * - Schema validation of the payload
 * - Upsert / delete in permission sets DDB table depending on the operation
 */

const {
  linksTable,
  AWS_REGION,
  artefactsBucketName,
  DdbTable,
  permissionSetProcessingTopicArn,
  functionLogMode,
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;

import {
  DynamoDBClient,
  DynamoDBServiceException,
} from "@aws-sdk/client-dynamodb";
import {
  DeleteObjectCommand,
  PutObjectCommand,
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
  QueryCommand,
  QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";

import Ajv from "ajv";
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CreateUpdatePermissionSetPayload,
  DeletePermissionSetPayload,
  logModes,
  requestStatus,
} from "../../helpers/src/interfaces";

import { v4 as uuidv4 } from "uuid";
import {
  imperativeParseJSON,
  JSONParserError,
} from "../../helpers/src/payload-validator";
import {
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";

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

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
let permissionSetName = "";

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const requestId = uuidv4().toString();
  logger(
    {
      handler: handlerName,
      logMode: logModes.Info,
      requestId: requestId,
      status: requestStatus.InProgress,
      statusMessage: `Permission Set create/update/delete operation started`,
    },
    functionLogMode
  );
  if (event.body !== null && event.body !== undefined) {
    try {
      const body = JSON.parse(event.body);
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          status: requestStatus.InProgress,
          statusMessage: `Permission set parsed successfully from message body`,
        },
        functionLogMode
      );
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          status: requestStatus.InProgress,
          statusMessage: `Determined permission set operation is determined to be ${body.action}`,
        },
        functionLogMode
      );
      if (body.action === "create" || body.action === "update") {
        const payload: CreateUpdatePermissionSetPayload = imperativeParseJSON(
          event.body,
          createUpdateValidate
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Permission Set validated successfully against the schema definition for create/update operation`,
          },
          functionLogMode
        );
        permissionSetName = payload.permissionSetData.permissionSetName;
        /**
         * AWS SSO enforces that the count of both AWS and customer managed
         * policies cannot exceed 10, validating this check
         */
        let totalManagedPoliciesCount = 0;
        if (
          payload.permissionSetData.managedPoliciesArnList &&
          payload.permissionSetData.managedPoliciesArnList.length > 0
        ) {
          totalManagedPoliciesCount +=
            payload.permissionSetData.managedPoliciesArnList.length;
        }
        if (
          payload.permissionSetData.customerManagedPoliciesList &&
          payload.permissionSetData.customerManagedPoliciesList.length > 0
        ) {
          totalManagedPoliciesCount +=
            payload.permissionSetData.customerManagedPoliciesList.length;
        }
        if (totalManagedPoliciesCount > 10) {
          logger({
            handler: handlerName,
            requestId: requestId,
            logMode: logModes.Exception,
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessageforLogger(
              requestId,
              "MangedPoliciesLimitExceeded",
              `Permisison set cannot have more that 10 managed policies (both AWS managed and customer managed) assigned. You provided ${totalManagedPoliciesCount} managedPolicies in total`,
              permissionSetName
            ),
          });
          return {
            statusCode: 500,
            body: JSON.stringify({
              message: constructExceptionMessageforLogger(
                requestId,
                "MangedPoliciesLimitExceeded",
                `Permisison set cannot have more that 10 managed policies (both AWS managed and customer managed) assigned. You provided ${totalManagedPoliciesCount} managedPolicies in total`,
                permissionSetName
              ),
              requestId: requestId,
            }),
          };
        }
        await s3clientObject.send(
          new PutObjectCommand({
            Bucket: artefactsBucketName,
            Key: `permission_sets/${permissionSetName}.json`,
            Body: JSON.stringify(payload.permissionSetData),
            ServerSideEncryption: "AES256",
          })
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Permission Set upsert to S3 successful`,
            relatedData: permissionSetName,
          },
          functionLogMode
        );
        const fetchPermissionSet: GetCommandOutput =
          await ddbDocClientObject.send(
            new GetCommand({
              TableName: DdbTable,
              Key: {
                permissionSetName: permissionSetName,
              },
            })
          );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Did a fetch on solution persistence to determine if we already know about this permission set`,
            relatedData: permissionSetName,
          },
          functionLogMode
        );
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: DdbTable,
            Item: {
              ...payload.permissionSetData,
            },
          })
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Permission Set upsert to Dynamo DB successful`,
            relatedData: permissionSetName,
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
                permissionSetName: permissionSetName,
                oldPermissionSetData: fetchPermissionSet.Item,
              }),
            })
          );
          logger(
            {
              handler: handlerName,
              logMode: logModes.Debug,
              requestId: requestId,
              status: requestStatus.InProgress,
              statusMessage: `Determined operation is update, posted the payload with upload action to permissionSetProcessorTopic`,
              relatedData: permissionSetName,
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
                permissionSetName: permissionSetName,
              }),
            })
          );
          logger(
            {
              handler: handlerName,
              logMode: logModes.Debug,
              requestId: requestId,
              status: requestStatus.InProgress,
              statusMessage: `Determined operation is create, posted the payload with create action to permissionSetProcessorTopic`,
              relatedData: permissionSetName,
            },
            functionLogMode
          );
        }

        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Completed processing of permission set payload at the interface level`,
            relatedData: permissionSetName,
          },
          functionLogMode
        );
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
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Permission Set validated successfully against the schema definition for delete operation`,
          },
          functionLogMode
        );
        permissionSetName = payload.permissionSetData.permissionSetName;
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
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            relatedData: permissionSetName,
            statusMessage: `Queried if there are any related account assignments`,
          },
          functionLogMode
        );

        if (relatedLinks.Items?.length !== 0) {
          logger(
            {
              handler: handlerName,
              logMode: logModes.Warn,
              requestId: requestId,
              status: requestStatus.Aborted,
              relatedData: permissionSetName,
              statusMessage: `Permission set delete operation is aborted as there are existing account assignments referencing this permission set`,
            },
            functionLogMode
          );
          return {
            statusCode: 400,
            body: JSON.stringify({
              message: `Permission Set ${payload.action} operation aborted as there are existing account assignments referencing the permission set`,
              requestId: requestId,
            }),
          };
        } else {
          logger(
            {
              handler: handlerName,
              logMode: logModes.Debug,
              requestId: requestId,
              status: requestStatus.InProgress,
              relatedData: permissionSetName,
              statusMessage: `Determined there are no account assignments referencing this permission set`,
            },
            functionLogMode
          );
          await s3clientObject.send(
            new DeleteObjectCommand({
              Bucket: artefactsBucketName,
              Key: `permission_sets/${payload.permissionSetData.permissionSetName}.json`,
            })
          );
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              relatedData: permissionSetName,
              status: requestStatus.InProgress,
              statusMessage: `Processed delete in S3`,
            },
            functionLogMode
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
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              relatedData: permissionSetName,
              status: requestStatus.InProgress,
              statusMessage: `Sent delete payload to permissionSet processing topic`,
            },
            functionLogMode
          );
          return {
            statusCode: 200,
            body: JSON.stringify({
              message: `Permission Set ${payload.action} operation is being processed`,
              requestId: requestId,
            }),
          };
        }
      } else {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Exception,
            requestId: requestId,
            relatedData: permissionSetName,
            status: requestStatus.FailedWithException,
            statusMessage: `Permission Set operation failed due to invalid action - ${body.action}`,
          },
          functionLogMode
        );
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
          handler: handlerName,
          requestId: requestId,
          logMode: logModes.Exception,
          status: requestStatus.FailedWithException,
          statusMessage: constructExceptionMessageforLogger(
            requestId,
            "Schema validation exception",
            `Provided permission set ${permissionSetName} payload does not pass the schema validation`,
            JSON.stringify(err.errors)
          ),
        });
        return {
          statusCode: 500,
          body: JSON.stringify({
            message: constructExceptionMessageforLogger(
              requestId,
              "Schema validation exception",
              `Provided permission set ${permissionSetName} payload does not pass the schema validation`,
              JSON.stringify(err.errors)
            ),
            requestId: requestId,
          }),
        };
      } else if (
        err instanceof S3ServiceException ||
        err instanceof DynamoDBServiceException ||
        err instanceof SNSServiceException
      ) {
        logger({
          handler: handlerName,
          requestId: requestId,
          logMode: logModes.Exception,
          status: requestStatus.FailedWithException,
          statusMessage: constructExceptionMessageforLogger(
            requestId,
            err.name,
            err.message,
            permissionSetName
          ),
        });
        return {
          statusCode: 500,
          body: JSON.stringify({
            message: constructExceptionMessageforLogger(
              requestId,
              err.name,
              err.message,
              permissionSetName
            ),
            requestId: requestId,
          }),
        };
      } else {
        logger({
          handler: handlerName,
          requestId: requestId,
          logMode: logModes.Exception,
          status: requestStatus.FailedWithException,
          statusMessage: constructExceptionMessageforLogger(
            requestId,
            "Unhandled exception",
            JSON.stringify(err),
            permissionSetName
          ),
        });
        return {
          statusCode: 500,
          body: JSON.stringify({
            requestId: requestId,
            message: constructExceptionMessageforLogger(
              requestId,
              "Unhandled exception",
              JSON.stringify(err),
              permissionSetName
            ),
          }),
        };
      }
    }
  } else {
    logger({
      handler: handlerName,
      requestId: requestId,
      logMode: logModes.Exception,
      status: requestStatus.FailedWithException,
      statusMessage: constructExceptionMessageforLogger(
        requestId,
        "Invalid message body exception",
        "Message body provided is invalid",
        permissionSetName
      ),
    });
    return {
      statusCode: 400,
      body: JSON.stringify({
        requestId: requestId,
        message: constructExceptionMessageforLogger(
          requestId,
          "Invalid message body exception",
          "Message body provided is invalid",
          permissionSetName
        ),
      }),
    };
  }
};

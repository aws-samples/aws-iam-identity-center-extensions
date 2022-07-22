/**
 * Objective: Implement event notification handler for permission set objects S3
 * path Trigger source: permission set S3 path object notification for removed
 * type events
 *
 * - Schema validation of the file name
 * - Delete in permission set DDB table parsing the file name
 */

// Environment configuration read
const {
  linksTable,
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
  PublishCommand,
  SNSClient,
  SNSServiceException,
} from "@aws-sdk/client-sns";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { S3Event, S3EventRecord } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import { JSONParserError } from "../../helpers/src/payload-validator";
import {
  constructExceptionMessage,
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";

const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
let permissionSetFileName = "";
const messageSubject =
  "Exception in permission set delete processing through S3 interface";

export const handler = async (event: S3Event) => {
  await Promise.all(
    event.Records.map(async (record: S3EventRecord) => {
      const requestId = uuidv4().toString();
      try {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Permission Set delete operation started`,
          },
          functionLogMode
        );
        const keyValue = record.s3.object.key.split("/")[1].split(".")[0];
        permissionSetFileName = keyValue;
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            relatedData: keyValue,
            statusMessage: `Split file name with path for fetching permission set name`,
          },
          functionLogMode
        );
        const relatedLinks = await ddbDocClientObject.send(
          new QueryCommand({
            TableName: linksTable,
            IndexName: "permissionSetName",
            KeyConditionExpression: "#permissionSetName = :permissionSetName",
            ExpressionAttributeNames: {
              "#permissionSetName": "permissionSetName",
            },
            ExpressionAttributeValues: { ":permissionSetName": keyValue },
          })
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            relatedData: keyValue,
            statusMessage: `Queried if there are any related account assignments using this permission set`,
          },
          functionLogMode
        );
        if (relatedLinks.Items?.length !== 0) {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Subject: messageSubject,
              Message: constructExceptionMessage(
                requestId,
                handlerName,
                "Constraint violation exception",
                "There are related account assignments for this permission set, and cannot be deleted without deleting the account assignments first",
                keyValue
              ),
            })
          );
          logger({
            handler: handlerName,
            logMode: logModes.Warn,
            relatedData: keyValue,
            requestId: requestId,
            status: requestStatus.Aborted,
            statusMessage: constructExceptionMessageforLogger(
              handlerName,
              "Constraint violation exception",
              "There are related account assignments for this permission set, and cannot be deleted without deleting the account assignments first",
              keyValue
            ),
          });
        } else {
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              status: requestStatus.InProgress,
              relatedData: keyValue,
              statusMessage: `No related account assignments found, posting payload to permissionSetProecsstingTopic`,
            },
            functionLogMode
          );
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: permissionSetProcessingTopicArn + "",
              Message: JSON.stringify({
                requestId: requestId,
                action: "delete",
                permissionSetName: keyValue,
              }),
            })
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
            logMode: logModes.Exception,
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessageforLogger(
              handlerName,
              "Schema validation exception",
              `Provided permission set ${permissionSetFileName} S3 file does not pass the schema validation`,
              JSON.stringify(err.errors)
            ),
          });
        } else if (
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
            logMode: logModes.Exception,
            requestId: requestId,
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessageforLogger(
              handlerName,
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
            logMode: logModes.Exception,
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessageforLogger(
              handlerName,
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

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
} = process.env;

// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { S3Event, S3EventRecord } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  ErrorMessage,
  logModes,
  requestStatus,
} from "../../helpers/src/interfaces";
import { JSONParserError } from "../../helpers/src/payload-validator";
import { logger } from "../../helpers/src/utilities";
// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });

const errorMessage: ErrorMessage = {
  Subject: "Error Processing Permission Set delete via S3 Interface",
};

export const handler = async (event: S3Event) => {
  await Promise.all(
    event.Records.map(async (record: S3EventRecord) => {
      try {
        const requestId = uuidv4().toString();
        const keyValue = record.s3.object.key.split("/")[1].split(".")[0];
        const relatedLinks = await ddbDocClientObject.send(
          // QueryCommand is a pagniated call, however the logic requires
          // checking only if the result set is greater than 0
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
        if (relatedLinks.Items?.length !== 0) {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Message: JSON.stringify({
                ...errorMessage,
                eventDetail: record,
                errorDetails:
                  "Cannot delete permission set as there are existing links that reference the permission set",
              }),
            })
          );
          logger({
            handler: "userInterface-permissionSetS3Delete",
            logMode: logModes.Warn,
            relatedData: keyValue,
            requestId: requestId,
            status: requestStatus.Aborted,
            statusMessage: `Permission Set delete operation aborted as there are existing account assignments referencing the permission set`,
          });
        } else {
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
          logger({
            handler: "userInterface-permissionSetS3Delete",
            logMode: logModes.Info,
            relatedData: keyValue,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Permission Set operation is being processed`,
          });
        }
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
          logger({
            handler: "userInterface-permissionSetS3Delete",
            logMode: logModes.Exception,
            status: requestStatus.FailedWithException,
            statusMessage: `Permission Set operation failed due to schema validation errors:${JSON.stringify(
              err.errors
            )}`,
          });
        } else {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Message: JSON.stringify({
                ...errorMessage,
                eventDetail: record,
                errorDetails: `Error processing permissionSet delete via S3 interface with exception: ${err}`,
              }),
            })
          );
          logger({
            handler: "userInterface-permissionSetS3Delete",
            logMode: logModes.Exception,
            status: requestStatus.FailedWithException,
            statusMessage: `Permission Set operation failed due to exception:${JSON.stringify(
              err
            )}`,
          });
        }
      }
    })
  );
};

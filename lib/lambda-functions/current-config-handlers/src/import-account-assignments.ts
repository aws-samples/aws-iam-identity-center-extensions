/** Objective: Import existing account assignments into the solution */

// Environment configuration read
const {
  linksTableName,
  provisionedLinksTableName,
  artefactsBucketName,
  AWS_REGION,
} = process.env;
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
// SDK and third party client imports
import { SNSEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  LinkData,
  logModes,
  requestStatus,
} from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const s3clientObject = new S3Client({ region: AWS_REGION, maxAttempts: 2 });

export const handler = async (event: SNSEvent) => {
  const requestId = uuidv4().toString();
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const provisionedLinksKey = `${
      message.provisionedLinksPayload.principalId
    }@${message.provisionedLinksPayload.targetId}@${
      message.linkPayload.PermissionSetArn.split("/")[1]
    }@${message.linkPayload.PermissionSetArn.split("/")[2]}`;
    logger({
      handler: "accountAssignmentImporter",
      logMode: logModes.Info,
      requestId: requestId,
      relatedData: provisionedLinksKey,
      status: requestStatus.InProgress,
      sourceRequestId: message.requestId,
      statusMessage: `Account assignment import operation in progress`,
    });
    if (message.triggerSource === "CloudFormation") {
      const provisionedLinks: GetCommandOutput = await ddbDocClientObject.send(
        new GetCommand({
          TableName: provisionedLinksTableName,
          Key: {
            parentLink: provisionedLinksKey,
          },
        })
      );
      if (provisionedLinks.Item) {
        logger({
          handler: "accountAssignmentImporter",
          logMode: logModes.Info,
          requestId: requestId,
          relatedData: provisionedLinksKey,
          status: requestStatus.Completed,
          sourceRequestId: message.requestId,
          statusMessage: `Account assignment import operation complete - link already exists`,
        });
      } else {
        const linkParams: LinkData = {
          awsEntityId: `account%${message.linkPayload.awsEntityData}%${message.linkPayload.permissionSetName}%${message.entityName}%${message.entityType}%ssofile`,
          awsEntityType: "account",
          awsEntityData: message.linkPayload.awsEntityData,
          permissionSetName: message.linkPayload.permissionSetName,
          principalName: message.entityName,
          principalType: message.entityType,
        };
        await s3clientObject.send(
          new PutObjectCommand({
            Bucket: artefactsBucketName,
            Key: `links_data/${linkParams.awsEntityId}`,
            ServerSideEncryption: "AES256",
          })
        );
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: linksTableName,
            Item: {
              ...linkParams,
            },
          })
        );
        await ddbClientObject.send(
          new PutCommand({
            TableName: provisionedLinksTableName,
            Item: {
              parentLink: provisionedLinksKey,
              tagKeyLookUp: "none",
              principalType: message.entityType,
            },
          })
        );
        logger({
          handler: "accountAssignmentImporter",
          logMode: logModes.Info,
          requestId: requestId,
          relatedData: provisionedLinksKey,
          status: requestStatus.Completed,
          sourceRequestId: message.requestId,
          statusMessage: `Account assignment import operation complete - link does not exist, so updated solution repository`,
        });
      }
    } else {
      logger({
        handler: "accountAssignmentImporter",
        logMode: logModes.Info,
        requestId: requestId,
        relatedData: provisionedLinksKey,
        status: requestStatus.Completed,
        sourceRequestId: message.requestId,
        statusMessage: `Account assignment import operation completed as the source trigger does not match`,
      });
    }
  } catch (err) {
    logger({
      handler: "accountAssignmentImporter",
      logMode: logModes.Exception,
      status: requestStatus.FailedWithException,
      statusMessage: `Account assignment import operation failed with exception: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`,
    });
  }
};

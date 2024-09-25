/** Objective: Import existing account assignments into the solution */

// Environment configuration read
const {
  linksTableName,
  provisionedLinksTableName,
  artefactsBucketName,
  AWS_REGION,
  functionLogMode,
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;
import {
  DynamoDBClient,
  DynamoDBServiceException,
} from "@aws-sdk/client-dynamodb";
import {
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
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
import {
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const s3clientObject = new S3Client({ region: AWS_REGION, maxAttempts: 2 });

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
let linkKeyValue = "";
let sourceRequestIdValue = "";

export const handler = async (event: SNSEvent) => {
  const requestId = uuidv4().toString();
  logger(
    {
      handler: handlerName,
      logMode: logModes.Info,
      requestId: requestId,
      relatedData: linkKeyValue,
      status: requestStatus.InProgress,
      statusMessage: `Started processing account assignment import operation`,
    },
    functionLogMode,
  );

  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const provisionedLinksKey = `${
      message.provisionedLinksPayload.principalId
    }@${message.provisionedLinksPayload.targetId}@${
      message.linkPayload.PermissionSetArn.split("/")[1]
    }@${message.linkPayload.PermissionSetArn.split("/")[2]}`;
    linkKeyValue = provisionedLinksKey;
    sourceRequestIdValue = message.requestId;
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestId,
        sourceRequestId: sourceRequestIdValue,
        relatedData: linkKeyValue,
        status: requestStatus.InProgress,
        statusMessage: `Parsed SNS payload `,
      },
      functionLogMode,
    );
    if (message.triggerSource === "CloudFormation") {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          relatedData: linkKeyValue,
          status: requestStatus.InProgress,
          sourceRequestId: sourceRequestIdValue,
          statusMessage: `Determined operation is for config import`,
        },
        functionLogMode,
      );
      const provisionedLinks: GetCommandOutput = await ddbDocClientObject.send(
        new GetCommand({
          TableName: provisionedLinksTableName,
          Key: {
            parentLink: provisionedLinksKey,
          },
        }),
      );
      if (provisionedLinks.Item) {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            relatedData: linkKeyValue,
            sourceRequestId: sourceRequestIdValue,
            status: requestStatus.Completed,
            statusMessage: `Account assignment already exists, not importing again`,
          },
          functionLogMode,
        );
      } else {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            relatedData: linkKeyValue,
            sourceRequestId: sourceRequestIdValue,
            status: requestStatus.InProgress,
            statusMessage: `Determined that the account assignment does not exist yet, updating the solution persistence`,
          },
          functionLogMode,
        );
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
          }),
        );
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: linksTableName,
            Item: {
              ...linkParams,
            },
          }),
        );
        await ddbClientObject.send(
          new PutCommand({
            TableName: provisionedLinksTableName,
            Item: {
              parentLink: provisionedLinksKey,
              tagKeyLookUp: "none",
              principalType: message.entityType,
            },
          }),
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            relatedData: linkKeyValue,
            sourceRequestId: sourceRequestIdValue,
            status: requestStatus.Completed,
            statusMessage: `Account assignment did not exist, so updated S3 and both provisioned links and links tables in DDB`,
          },
          functionLogMode,
        );
      }
    } else {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          relatedData: linkKeyValue,
          sourceRequestId: sourceRequestIdValue,
          status: requestStatus.Aborted,
          statusMessage: `Account assignment operation aborted as the operation type is unknown`,
        },
        functionLogMode,
      );
    }
  } catch (err) {
    if (
      err instanceof DynamoDBServiceException ||
      err instanceof S3ServiceException
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
          linkKeyValue,
        ),
      });
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
          linkKeyValue,
        ),
      });
    }
  }
};

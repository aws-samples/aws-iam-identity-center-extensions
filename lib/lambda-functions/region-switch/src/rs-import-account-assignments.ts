/**
 * Imports account assignments into global tables. Triggered by account
 * assignment import SNS topic. Code formats the account assignment data in a
 * way that aligns with the extensions solution for re-usability purposes.
 */

/** Get environment variables */
const { globalAccountAssignmentsTableName, AWS_REGION } = process.env;
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
/** SDK and third party client imports */
import { SNSEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { LinkData, requestStatus } from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";

/**
 * SDK and third party client instantiations done as part of init context for
 * optimisation purposes. All AWS JS SDK clients are configured with a default
 * exponential retry limit of 2
 */
const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);

export const handler = async (event: SNSEvent) => {
  /** Instantiate UUID based request ID for observability */
  const requestId = uuidv4().toString();
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    /**
     * Format the account assignment data in a format compatible with
     * sso-extensions solution
     */
    const linkParams: LinkData = {
      awsEntityId: `account%${message.linkPayload.awsEntityData}%${message.linkPayload.permissionSetName}%${message.entityName}%${message.entityType}%ssofile`,
      awsEntityType: "account",
      awsEntityData: message.linkPayload.awsEntityData,
      permissionSetName: message.linkPayload.permissionSetName,
      principalName: message.entityName,
      principalType: message.entityType,
    };
    logger({
      handler: "rs-accountAssignmentImporter",
      logMode: "info",
      requestId: requestId,
      relatedData: linkParams.awsEntityId,
      status: requestStatus.InProgress,
      sourceRequestId: message.requestId,
      statusMessage: `Region switch account assignment import operation in progress`,
    });
    /** Upsert account assignment data into the global table */
    await ddbDocClientObject.send(
      new PutCommand({
        TableName: globalAccountAssignmentsTableName,
        Item: {
          ...linkParams,
        },
      })
    );
    logger({
      handler: "rs-accountAssignmentImporter",
      logMode: "info",
      requestId: requestId,
      relatedData: linkParams.awsEntityId,
      status: requestStatus.Completed,
      sourceRequestId: message.requestId,
      statusMessage: `Region switch account assignment import operation in progress`,
    });
  } catch (err) {
    logger({
      handler: "rs-accountAssignmentImporter",
      logMode: "error",
      status: requestStatus.FailedWithException,
      statusMessage: `Account assignment import operation failed with exception: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`,
    });
  }
};

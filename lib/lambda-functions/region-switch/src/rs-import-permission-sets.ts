/**
 * Imports permission sets into global tables. Triggered by permission set
 * import topic, formats the permission set object in a format compatible with
 * sso-extensions solution, handles optional attributes and upserts the
 * permission set object into global tables
 */

/** Get environment variables */
const { globalPermissionSetTableName, AWS_REGION } = process.env;

/** SDK and third party client imports */
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SNSEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import { getMinutesFromISODurationString } from "../../helpers/src/isoDurationUtility";
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
    const permissionSetName = message.describePermissionSet.PermissionSet.Name;
    logger({
      handler: "rs-permissionSetImporter",
      logMode: logModes.Info,
      requestId: requestId,
      relatedData: permissionSetName,
      status: requestStatus.InProgress,
      sourceRequestId: message.requestId,
      statusMessage: `Region switch Permission set import operation in progress`,
    });

    /**
     * Construct permission set object from the message payload by instantiating
     * all optional attributes as empty, and if the message payload has data for
     * these optional attributes use that value, otherwise use the empty
     * initialisation
     */
    const permissionSetObject = {};
    let computedRelayState = "";
    let computedInlinePolicy = {};
    let computedSessionDurationInMinutes = "";
    const computedManagedPoliciesArnList: Array<string> = [];
    if (
      Object.prototype.hasOwnProperty.call(
        message.describePermissionSet.PermissionSet,
        "RelayState",
      )
    ) {
      computedRelayState =
        message.describePermissionSet.PermissionSet.RelayState;
    }
    if (
      Object.prototype.hasOwnProperty.call(
        message.describePermissionSet.PermissionSet,
        "SessionDuration",
      )
    ) {
      computedSessionDurationInMinutes = getMinutesFromISODurationString(
        message.describePermissionSet.PermissionSet.SessionDuration,
      );
    }
    if (
      message.listManagedPoliciesInPermissionSet.AttachedManagedPolicies
        .length > 0
    ) {
      await Promise.all(
        message.listManagedPoliciesInPermissionSet.AttachedManagedPolicies.map(
          async (managedPolicy: Record<string, string>) => {
            computedManagedPoliciesArnList.push(managedPolicy.Arn);
          },
        ),
      );
    }
    if (message.getInlinePolicyForPermissionSet.InlinePolicy.length > 0) {
      computedInlinePolicy = JSON.parse(
        message.getInlinePolicyForPermissionSet.InlinePolicy,
      );
    }
    /**
     * Once all the optional attributes are verified, construct the permission
     * set object in a format compatible with sso-extensions and ready for
     * upsert
     */

    Object.assign(permissionSetObject, {
      permissionSetName: permissionSetName,
      sessionDurationInMinutes: computedSessionDurationInMinutes,
      relayState: computedRelayState,
      tags: message.listTagsForResource.Tags,
      managedPoliciesArnList: [...computedManagedPoliciesArnList].sort(),
      inlinePolicyDocument: computedInlinePolicy,
    });
    /** Upsert the permission set object in the global table */
    await ddbDocClientObject.send(
      new PutCommand({
        TableName: globalPermissionSetTableName,
        Item: {
          ...permissionSetObject,
        },
      }),
    );

    logger({
      handler: "rs-permissionSetImporter",
      logMode: logModes.Info,
      requestId: requestId,
      relatedData: permissionSetName,
      status: requestStatus.Completed,
      sourceRequestId: message.requestId,
      statusMessage: `Permission set import completed`,
    });
  } catch (err) {
    logger({
      handler: "permissionSetImporter",
      logMode: logModes.Exception,
      status: requestStatus.FailedWithException,
      statusMessage: `Permission set import operation failed with exception: ${JSON.stringify(
        err,
      )} for eventDetail: ${JSON.stringify(event)}`,
    });
  }
};

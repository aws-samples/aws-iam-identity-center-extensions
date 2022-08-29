/**
 * Creates permission sets in AWS SSO. Triggered by Region switch deploy state
 * machine with payload containing instance arn, identity store Id and
 * permission set object payload. Permission set object payload aligns to the
 * format used by the solution interfaces Validates if optional attributes are
 * present first before triggering the create operation. The code reads
 * parameters that are not required by the lambda handler so that the subsequent
 * steps in the state machine only get the required data. Alternative is for the
 * lambda invocation to send back the full response payload which is not
 * required
 */

/** Get environment variables */
const { AWS_REGION } = process.env;

/** SDK and third party client imports */
import {
  AttachManagedPolicyToPermissionSetCommand,
  CreatePermissionSetCommand,
  PutInlinePolicyToPermissionSetCommand,
  SSOAdminClient,
  TagResourceCommand,
} from "@aws-sdk/client-sso-admin";
import { unmarshall } from "@aws-sdk/util-dynamodb";
import { v4 as uuidv4 } from "uuid";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import { serializeDurationToISOFormat } from "../../helpers/src/isoDurationUtility";
import { logger } from "../../helpers/src/utilities";

/**
 * SDK and third party client instantiations done as part of init context for
 * optimisation purposes. All AWS JS SDK clients are configured with a default
 * exponential retry limit of 2
 */
const ssoAdminClientObject = new SSOAdminClient({
  region: AWS_REGION,
  maxAttempts: 2,
});

/**
 * Explicit any as the event is triggered through the state machine with a
 * custom payload
 */
/* eslint-disable  @typescript-eslint/no-explicit-any */
export const handler = async (event: any) => {
  /** Instantiate UUID based request ID for observability */
  const requestId = uuidv4().toString();
  /** Assign common data elements */
  const instanceArn = event.InstanceArn;
  const identityStoreId = event.IdentityStoreId;
  const globalAccountAssignmentsTable = event.globalAccountAssignmentsTable;
  const pageSize = event.pageSize;
  const waitSeconds = event.waitSeconds;
  try {
    /** Entry log to indicate start of processing */
    logger({
      requestId: requestId,
      handler: "rs-create-permission-set-handler",
      logMode: logModes.Info,
      status: requestStatus.InProgress,
      relatedData: event.PermissionSetObject.permissionSetName.S,
    });
    /**
     * Dynamo DB JSON data needs to be unmarhsalled , otherwise the data
     * elements would have keys specific to dynamo DB data types
     */
    const permissionSetObject = unmarshall(event.PermissionSetObject);
    /**
     * Create Permission set with the default attributes. Appending with an
     * empty string is to both allow TS type check to pass as well as handle
     * scenarios where this could be an empty value
     */
    const createOp = await ssoAdminClientObject.send(
      new CreatePermissionSetCommand({
        InstanceArn: instanceArn,
        Name: permissionSetObject.permissionSetName,
        Description: permissionSetObject.permissionSetName,
        RelayState: permissionSetObject.relayState + "",
        SessionDuration: serializeDurationToISOFormat({
          minutes: parseInt(permissionSetObject.sessionDurationInMinutes + ""),
        }),
      })
    );
    /**
     * Fetch permission set ARN as this is generated run time by the service and
     * is referenced in subsequent operations both within the lambda as well as
     * for account assignment operations
     */
    const permissionSetArn =
      createOp.PermissionSet?.PermissionSetArn?.toString() + "";
    /**
     * Start processing optional attributes, and therefore check for existence
     * of the attributes before provisioning them
     */
    if (permissionSetObject.tags.lenth !== 0) {
      await ssoAdminClientObject.send(
        new TagResourceCommand({
          InstanceArn: instanceArn,
          ResourceArn: permissionSetArn,
          Tags: permissionSetObject.tags,
        })
      );
    }
    if (permissionSetObject.managedPoliciesArnList.length !== 0) {
      /**
       * Based on the recommmendation from service team, addition of managed
       * policies to the permission set is serialised instead of being run in
       * parallel
       */
      for (const managedPolicyArn of permissionSetObject.managedPoliciesArnList) {
        await ssoAdminClientObject.send(
          new AttachManagedPolicyToPermissionSetCommand({
            InstanceArn: instanceArn,
            PermissionSetArn: permissionSetArn,
            ManagedPolicyArn: managedPolicyArn,
          })
        );
      }
    }
    if ("inlinePolicyDocument" in permissionSetObject) {
      if (Object.keys(permissionSetObject.inlinePolicyDocument).length !== 0) {
        await ssoAdminClientObject.send(
          new PutInlinePolicyToPermissionSetCommand({
            InstanceArn: instanceArn,
            InlinePolicy: JSON.stringify(
              permissionSetObject.inlinePolicyDocument
            ),
            PermissionSetArn: permissionSetArn,
          })
        );
      }
    }
    /**
     * Return the payload back to state machine with the permission set arn for
     * next steps i.e. account assignment provisioning
     */
    return {
      permissionSetName: permissionSetObject.permissionSetName,
      permissionSetArn: permissionSetArn,
      identityStoreId: identityStoreId,
      instanceArn: instanceArn,
      globalAccountAssignmentsTable: globalAccountAssignmentsTable,
      pageSize: pageSize,
      waitSeconds: waitSeconds,
    };
  } catch (err) {
    /** Generic catch all exception logger */
    logger({
      requestId: requestId,
      handler: "rs-create-permission-set-handler",
      logMode: logModes.Exception,
      status: requestStatus.FailedWithException,
      statusMessage: `Permission set create operation failed with exception: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`,
    });
    /**
     * Return payload with exception details in case of failure so that the
     * state machine can handle this gracefully
     */
    return {
      lambdaException: JSON.stringify(err),
    };
  }
};

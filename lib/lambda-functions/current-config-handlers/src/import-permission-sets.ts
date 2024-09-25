/** Objective: Import existing permission sets into the solution */

// Environment configuration read
const {
  ssoRegion,
  SSOAPIRoleArn,
  permissionSetTableName,
  permissionSetArnTableName,
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
  ListAccountsForProvisionedPermissionSetCommand,
  ListInstancesCommand,
  ListInstancesCommandOutput,
  ProvisionPermissionSetCommand,
  SSOAdminClient,
  SSOAdminServiceException,
} from "@aws-sdk/client-sso-admin";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import {
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
  PutCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
// SDK and third party client imports
import { SNSEvent } from "aws-lambda";
import { diff } from "json-diff";
import { v4 as uuidv4 } from "uuid";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import { getMinutesFromISODurationString } from "../../helpers/src/isoDurationUtility";
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
const ssoAdminClientObject = new SSOAdminClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: SSOAPIRoleArn,
    },
  }),
  maxAttempts: 2,
});
const s3clientObject = new S3Client({ region: AWS_REGION, maxAttempts: 2 });
const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
let sourceRequestIdValue = "";
let permissionSetNameValue = "";

export const handler = async (event: SNSEvent) => {
  const requestId = uuidv4().toString();
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const permissionSetName = message.describePermissionSet.PermissionSet.Name;
    const permissionSetArn =
      message.describePermissionSet.PermissionSet.PermissionSetArn;
    sourceRequestIdValue = message.requestId;
    permissionSetNameValue = permissionSetName;
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestId,
        sourceRequestId: sourceRequestIdValue,
        relatedData: permissionSetNameValue,
        status: requestStatus.InProgress,
        statusMessage: `Permission set import operation in progress`,
      },
      functionLogMode,
    );
    /** Construct permission set object from the SNS message payload */
    const permissionSetObject = {};

    /** Assing permissionSetName to permission set object */

    Object.assign(permissionSetObject, {
      permissionSetName: permissionSetName,
    });

    /** Tags are optional attributes */
    if (
      Object.prototype.hasOwnProperty.call(message.listTagsForResource, "Tags")
    ) {
      if (message.listTagsForResource.Tags.length > 0) {
        Object.assign(permissionSetObject, {
          tags: message.listTagsForResource.Tags,
        });
      }
    }

    /** Relay state is an optional attribute */

    if (
      Object.prototype.hasOwnProperty.call(
        message.describePermissionSet.PermissionSet,
        "RelayState",
      )
    ) {
      Object.assign(permissionSetObject, {
        relayState: message.describePermissionSet.PermissionSet.RelayState,
      });
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          sourceRequestId: sourceRequestIdValue,
          relatedData: permissionSetNameValue,
          status: requestStatus.InProgress,
          statusMessage: `Determined that the imported permission set has relayState set as ${message.describePermissionSet.PermissionSet.RelayState}`,
        },
        functionLogMode,
      );
    }

    // Session Duration is an optional attribute
    if (
      Object.prototype.hasOwnProperty.call(
        message.describePermissionSet.PermissionSet,
        "SessionDuration",
      )
    ) {
      Object.assign(permissionSetObject, {
        sessionDurationInMinutes: getMinutesFromISODurationString(
          message.describePermissionSet.PermissionSet.SessionDuration,
        ),
      });
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          sourceRequestId: sourceRequestIdValue,
          relatedData: permissionSetNameValue,
          status: requestStatus.InProgress,
          statusMessage: `Determined that the imported permission set has sessionDuration set as ${getMinutesFromISODurationString(
            message.describePermissionSet.PermissionSet.SessionDuration,
          )} minutes`,
        },
        functionLogMode,
      );
    }
    // Managed policies is an optional attribute
    if (
      message.listManagedPoliciesInPermissionSet.AttachedManagedPolicies
        .length > 0
    ) {
      /** Instantiate empty computedManagedPoliciesArnList array */
      const computedManagedPoliciesArnList: Array<string> = [];
      await Promise.all(
        message.listManagedPoliciesInPermissionSet.AttachedManagedPolicies.map(
          async (managedPolicy: Record<string, string>) => {
            computedManagedPoliciesArnList.push(managedPolicy.Arn);
          },
        ),
      );
      Object.assign(permissionSetObject, {
        managedPoliciesArnList: [...computedManagedPoliciesArnList].sort(),
      });
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          sourceRequestId: sourceRequestIdValue,
          relatedData: permissionSetNameValue,
          status: requestStatus.InProgress,
          statusMessage: `Determined that the imported permission set has managed policies set`,
        },
        functionLogMode,
      );
    }
    // Inline policy is an optional attribute
    if (message.getInlinePolicyForPermissionSet.InlinePolicy.length > 0) {
      Object.assign(permissionSetObject, {
        inlinePolicyDocument: JSON.parse(
          message.getInlinePolicyForPermissionSet.InlinePolicy,
        ),
      });
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          sourceRequestId: sourceRequestIdValue,
          relatedData: permissionSetNameValue,
          status: requestStatus.InProgress,
          statusMessage: `Determined that the imported permission set has inline policy set`,
        },
        functionLogMode,
      );
    }

    /** Permissions boundary is an optional attribute */
    if (
      message.fetchPermissionsBoundary.Payload.result.PermissionsBoundary &&
      Object.keys(
        message.fetchPermissionsBoundary.Payload.result.PermissionsBoundary,
      ).length !== 0
    ) {
      Object.assign(permissionSetObject, {
        permissionsBoundary:
          message.fetchPermissionsBoundary.Payload.result.PermissionsBoundary,
      });
    }

    /** Customer Managed Policies are an optional attribute */
    if (
      message.fetchCustomerManagedPolicies.Payload.result
        .CustomerManagedPolicyReferences &&
      message.fetchCustomerManagedPolicies.Payload.result
        .CustomerManagedPolicyReferences.length !== 0
    ) {
      Object.assign(permissionSetObject, {
        customerManagedPoliciesList:
          message.fetchCustomerManagedPolicies.Payload.result
            .CustomerManagedPolicyReferences,
      });
    }

    if (message.triggerSource === "CloudFormation") {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          sourceRequestId: sourceRequestIdValue,
          relatedData: permissionSetNameValue,
          status: requestStatus.InProgress,
          statusMessage: `Determined that the operation type is current config import`,
        },
        functionLogMode,
      );
      const fetchPermissionSet: GetCommandOutput =
        await ddbDocClientObject.send(
          new GetCommand({
            TableName: permissionSetTableName,
            Key: {
              permissionSetName: permissionSetName,
            },
          }),
        );
      const fetchArn: GetCommandOutput = await ddbDocClientObject.send(
        new GetCommand({
          TableName: permissionSetArnTableName,
          Key: {
            permissionSetName,
          },
        }),
      );
      if (fetchPermissionSet.Item && fetchArn.Item) {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            sourceRequestId: sourceRequestIdValue,
            relatedData: permissionSetNameValue,
            status: requestStatus.InProgress,
            statusMessage: `Validated that permission set already exists, now determining delta`,
          },
          functionLogMode,
        );

        const sortedFetchItemManagedPolicies =
          fetchPermissionSet.Item.managedPoliciesArnList.sort();
        fetchPermissionSet.Item.managedPoliciesArnList =
          sortedFetchItemManagedPolicies;

        const diffCalculated = diff(
          fetchPermissionSet.Item,
          permissionSetObject,
        );
        if (diffCalculated === undefined) {
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              sourceRequestId: sourceRequestIdValue,
              relatedData: permissionSetNameValue,
              status: requestStatus.Completed,
              statusMessage: `No delta found, completing import operation`,
            },
            functionLogMode,
          );
        } else {
          const resolvedInstances: ListInstancesCommandOutput =
            await ssoAdminClientObject.send(new ListInstancesCommand({}));
          const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
          await ddbDocClientObject.send(
            new PutCommand({
              TableName: permissionSetTableName,
              Item: {
                ...permissionSetObject,
              },
            }),
          );
          await s3clientObject.send(
            new PutObjectCommand({
              Bucket: artefactsBucketName,
              Key: `permission_sets/${permissionSetName}.json`,
              Body: JSON.stringify(permissionSetObject),
              ServerSideEncryption: "AES256",
            }),
          );
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              sourceRequestId: sourceRequestIdValue,
              relatedData: permissionSetNameValue,
              status: requestStatus.InProgress,
              statusMessage: `Delta found, updated solution persistence with new permission set object value`,
            },
            functionLogMode,
          );
          const fetchAccountsList = await ssoAdminClientObject.send(
            new ListAccountsForProvisionedPermissionSetCommand({
              InstanceArn: instanceArn,
              PermissionSetArn: permissionSetArn,
            }),
          );
          if (fetchAccountsList.AccountIds?.length !== 0) {
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestId,
                sourceRequestId: sourceRequestIdValue,
                relatedData: permissionSetNameValue,
                status: requestStatus.InProgress,
                statusMessage: `Determined that accounts are already assigned the permission set, triggering a resync`,
              },
              functionLogMode,
            );
            await ssoAdminClientObject.send(
              new ProvisionPermissionSetCommand({
                InstanceArn: instanceArn,
                PermissionSetArn: permissionSetArn,
                TargetType: "ALL_PROVISIONED_ACCOUNTS",
              }),
            );
          }
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              sourceRequestId: sourceRequestIdValue,
              relatedData: permissionSetNameValue,
              status: requestStatus.Completed,
              statusMessage: `Delta handling complete, import permission set operation complete`,
            },
            functionLogMode,
          );
        }
      } else {
        await s3clientObject.send(
          new PutObjectCommand({
            Bucket: artefactsBucketName,
            Key: `permission_sets/${permissionSetName}.json`,
            Body: JSON.stringify(permissionSetObject),
            ServerSideEncryption: "AES256",
          }),
        );
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: permissionSetTableName,
            Item: {
              ...permissionSetObject,
            },
          }),
        );
        await ddbDocClientObject.send(
          new UpdateCommand({
            TableName: permissionSetArnTableName,
            Key: {
              permissionSetName,
            },
            UpdateExpression: "set permissionSetArn=:arnvalue",
            ExpressionAttributeValues: {
              ":arnvalue": permissionSetArn,
            },
          }),
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            sourceRequestId: sourceRequestIdValue,
            relatedData: permissionSetNameValue,
            status: requestStatus.Completed,
            statusMessage: `Updated solution persistence, import permission set operation complete`,
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
          sourceRequestId: sourceRequestIdValue,
          relatedData: permissionSetNameValue,
          status: requestStatus.Aborted,
          statusMessage: `Unknown operation type, aborting import permission set operation`,
        },
        functionLogMode,
      );
    }
  } catch (err) {
    if (
      err instanceof DynamoDBServiceException ||
      err instanceof S3ServiceException ||
      err instanceof SSOAdminServiceException
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
          permissionSetNameValue,
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
          permissionSetNameValue,
        ),
      });
    }
  }
};

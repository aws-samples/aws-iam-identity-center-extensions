/*
Objective: Import existing permission sets into the solution
*/

// Environment configuration read
const {
  ssoRegion,
  SSOAPIRoleArn,
  permissionSetTableName,
  permissionSetArnTableName,
  artefactsBucketName,
  AWS_REGION,
} = process.env;

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import {
  ListAccountsForProvisionedPermissionSetCommand,
  ListInstancesCommand,
  ListInstancesCommandOutput,
  ProvisionPermissionSetCommand,
  SSOAdminClient,
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
import { requestStatus } from "../../helpers/src/interfaces";
import { getMinutesFromISODurationString } from "../../helpers/src/isoDurationUtility";
import { logger } from "../../helpers/src/utilities";

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

export const handler = async (event: SNSEvent) => {
  const requestId = uuidv4().toString();
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const permissionSetName = message.describePermissionSet.PermissionSet.Name;
    const permissionSetArn =
      message.describePermissionSet.PermissionSet.PermissionSetArn;
    logger({
      handler: "permissionSetImporter",
      logMode: "info",
      requestId: requestId,
      relatedData: permissionSetName,
      status: requestStatus.InProgress,
      sourceRequestId: message.requestId,
      statusMessage: `Permission set import operation in progress`,
    });

    // Construct permission set object from the SNS message payload
    const permissionSetObject = {};
    let computedRelayState = "";
    let computedInlinePolicy = {};
    let computedSessionDurationInMinutes = "";
    const computedManagedPoliciesArnList: Array<string> = [];

    //Relay state is an optional attribute
    if (
      Object.prototype.hasOwnProperty.call(
        message.describePermissionSet.PermissionSet,
        "RelayState"
      )
    ) {
      computedRelayState =
        message.describePermissionSet.PermissionSet.RelayState;
    }
    // Session Duration is an optional attribute
    if (
      Object.prototype.hasOwnProperty.call(
        message.describePermissionSet.PermissionSet,
        "SessionDuration"
      )
    ) {
      computedSessionDurationInMinutes = getMinutesFromISODurationString(
        message.describePermissionSet.PermissionSet.SessionDuration
      );
    }
    // Managed policies is an optional attribute
    if (
      message.listManagedPoliciesInPermissionSet.AttachedManagedPolicies
        .length > 0
    ) {
      await Promise.all(
        message.listManagedPoliciesInPermissionSet.AttachedManagedPolicies.map(
          async (managedPolicy: Record<string, string>) => {
            computedManagedPoliciesArnList.push(managedPolicy.Arn);
          }
        )
      );
    }
    // Inline policy is an optional attribute
    if (message.getInlinePolicyForPermissionSet.InlinePolicy.length > 0) {
      computedInlinePolicy = JSON.parse(
        message.getInlinePolicyForPermissionSet.InlinePolicy
      );
    }

    Object.assign(permissionSetObject, {
      permissionSetName: permissionSetName,
      sessionDurationInMinutes: computedSessionDurationInMinutes,
      relayState: computedRelayState,
      tags: message.listTagsForResource.Tags,
      managedPoliciesArnList: computedManagedPoliciesArnList.sort(),
      inlinePolicyDocument: computedInlinePolicy,
    });

    if (message.triggerSource === "CloudFormation") {
      const fetchPermissionSet: GetCommandOutput =
        await ddbDocClientObject.send(
          new GetCommand({
            TableName: permissionSetTableName,
            Key: {
              permissionSetName: permissionSetName,
            },
          })
        );
      const fetchArn: GetCommandOutput = await ddbDocClientObject.send(
        new GetCommand({
          TableName: permissionSetArnTableName,
          Key: {
            permissionSetName,
          },
        })
      );
      if (fetchPermissionSet.Item && fetchArn.Item) {
        logger({
          handler: "permissionSetImporter",
          logMode: "info",
          requestId: requestId,
          relatedData: permissionSetName,
          status: requestStatus.InProgress,
          sourceRequestId: message.requestId,
          statusMessage: `CloudFormation mode - permission set object already present. Now checking if there's a delta`,
        });

        const sortedFetchItemManagedPolicies =
          fetchPermissionSet.Item.managedPoliciesArnList.sort();
        fetchPermissionSet.Item.managedPoliciesArnList =
          sortedFetchItemManagedPolicies;

        const diffCalculated = diff(
          fetchPermissionSet.Item,
          permissionSetObject
        );
        if (diffCalculated === undefined) {
          logger({
            handler: "permissionSetImporter",
            logMode: "info",
            requestId: requestId,
            relatedData: permissionSetName,
            status: requestStatus.Completed,
            sourceRequestId: message.requestId,
            statusMessage: `CloudFormation mode - no delta found, completing import operation`,
          });
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
            })
          );
          await s3clientObject.send(
            new PutObjectCommand({
              Bucket: artefactsBucketName,
              Key: `permission_sets/${permissionSetName}.json`,
              Body: JSON.stringify(permissionSetObject),
              ServerSideEncryption: "AES256",
            })
          );
          logger({
            handler: "permissionSetImporter",
            logMode: "info",
            requestId: requestId,
            relatedData: permissionSetName,
            status: requestStatus.InProgress,
            sourceRequestId: message.requestId,
            statusMessage: `CloudFormation mode - delta found, updated solution persistence with new permission set object value`,
          });
          const fetchAccountsList = await ssoAdminClientObject.send(
            new ListAccountsForProvisionedPermissionSetCommand({
              InstanceArn: instanceArn,
              PermissionSetArn: permissionSetArn,
            })
          );
          if (fetchAccountsList.AccountIds?.length !== 0) {
            await ssoAdminClientObject.send(
              new ProvisionPermissionSetCommand({
                InstanceArn: instanceArn,
                PermissionSetArn: permissionSetArn,
                TargetType: "ALL_PROVISIONED_ACCOUNTS",
              })
            );
            logger({
              handler: "permissionSetImporter",
              logMode: "info",
              requestId: requestId,
              relatedData: permissionSetName,
              status: requestStatus.InProgress,
              sourceRequestId: message.requestId,
              statusMessage: `CloudFormation mode - delta found, triggered re-provisioning operation on all provisioned accounts`,
            });
          }
          logger({
            handler: "permissionSetImporter",
            logMode: "info",
            requestId: requestId,
            relatedData: permissionSetName,
            status: requestStatus.Completed,
            sourceRequestId: message.requestId,
            statusMessage: `CloudFormation mode - delta found, import operation completed`,
          });
        }
      } else {
        await s3clientObject.send(
          new PutObjectCommand({
            Bucket: artefactsBucketName,
            Key: `permission_sets/${permissionSetName}.json`,
            Body: JSON.stringify(permissionSetObject),
            ServerSideEncryption: "AES256",
          })
        );
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: permissionSetTableName,
            Item: {
              ...permissionSetObject,
            },
          })
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
          })
        );
        logger({
          handler: "permissionSetImporter",
          logMode: "info",
          requestId: requestId,
          relatedData: permissionSetName,
          status: requestStatus.InProgress,
          sourceRequestId: message.requestId,
          statusMessage: `CloudFormation mode - permission set object not present, import completed`,
        });
      }
    } else {
      logger({
        handler: "permissionSetImporter",
        logMode: "info",
        requestId: requestId,
        relatedData: permissionSetName,
        status: requestStatus.Completed,
        sourceRequestId: message.requestId,
        statusMessage: `Permission set import operation completed as the source trigger does not match`,
      });
    }
  } catch (err) {
    logger({
      handler: "permissionSetImporter",
      logMode: "error",
      status: requestStatus.FailedWithException,
      statusMessage: `Permission set import operation failed with exception: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`,
    });
  }
};

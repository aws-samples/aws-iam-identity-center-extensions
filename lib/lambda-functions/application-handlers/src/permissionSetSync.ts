/**
 * Objective: Implement permission set sync Trigger source: Permission set sync
 * notification which in turn is triggered by permission set topic handler when
 * it determines that there is a permission set being created/updated that has
 * not yet been provisioned
 *
 * - Assumes role in SSO account for calling SSO admin API
 * - Fetches if there are links provisioned already for the permission set in the
 *   links table
 * - Process the appropriate links
 * - Catch all failures in a generic exception block and post the error details to
 *   error notifications topics
 */

const {
  linksTableName,
  linkQueueUrl,
  adUsed,
  domainName,
  SSOAPIRoleArn,
  ISAPIRoleArn,
  orgListSMRoleArn,
  processTargetAccountSMTopicArn,
  processTargetAccountSMArn,
  errorNotificationsTopicArn,
  ssoRegion,
  supportNestedOU,
  AWS_REGION,
} = process.env;

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { IdentitystoreClient } from "@aws-sdk/client-identitystore";
import { SFNClient } from "@aws-sdk/client-sfn";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  ListInstancesCommand,
  ListInstancesCommandOutput,
  SSOAdminClient,
} from "@aws-sdk/client-sso-admin";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import {
  DynamoDBDocumentClient,
  QueryCommand,
  QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { SNSEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  ErrorMessage,
  requestStatus,
  StateMachinePayload,
  StaticSSOPayload,
} from "../../helpers/src/interfaces";
import {
  invokeStepFunction,
  logger,
  resolvePrincipal,
} from "../../helpers/src/utilities";

const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });
const sqsClientObject = new SQSClient({ region: AWS_REGION, maxAttempts: 2 });

const ssoAdminClientObject = new SSOAdminClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: SSOAPIRoleArn,
    },
  }),
  maxAttempts: 2,
});
const identityStoreClientObject = new IdentitystoreClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: ISAPIRoleArn,
    },
  }),
});
const sfnClientObject = new SFNClient({
  region: "us-east-1",
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: orgListSMRoleArn,
    },
  }),
  maxAttempts: 2,
});

const errorMessage: ErrorMessage = {
  Subject: "Error Processing link stream handler",
};

export const handler = async (event: SNSEvent) => {
  const requestId = uuidv4().toString();
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const relatedLinks: QueryCommandOutput = await ddbDocClientObject.send(
      new QueryCommand({
        TableName: linksTableName,
        IndexName: "permissionSetName",
        KeyConditionExpression: "#permissionSetName = :permissionSetName",
        ExpressionAttributeNames: { "#permissionSetName": "permissionSetName" },
        ExpressionAttributeValues: {
          ":permissionSetName": message.permission_set_name,
        },
      })
    );
    logger({
      handler: "permissionSetSyncHandler",
      logMode: "info",
      requestId: requestId,
      relatedData: `${message.permission_set_name}`,
      status: requestStatus.InProgress,
      statusMessage: `Permission Set sync - operation started`,
    });

    if (relatedLinks.Items && relatedLinks.Items.length !== 0) {
      const resolvedInstances: ListInstancesCommandOutput =
        await ssoAdminClientObject.send(new ListInstancesCommand({}));
      const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
      const identityStoreId =
        resolvedInstances.Instances?.[0].IdentityStoreId + "";

      await Promise.all(
        relatedLinks.Items.map(async (Item) => {
          let principalNameToLookUp = Item.principalName;
          if (adUsed === "true" && domainName !== "") {
            principalNameToLookUp = `${Item.principalName}@${domainName}`;
          }
          const principalId = await resolvePrincipal(
            identityStoreId,
            identityStoreClientObject,
            Item.principalType,
            principalNameToLookUp
          );
          const staticSSOPayload: StaticSSOPayload = {
            InstanceArn: instanceArn,
            TargetType: "AWS_ACCOUNT",
            PrincipalType: Item.principalType,
          };
          if (principalId !== "0") {
            if (Item.awsEntityType === "account") {
              await sqsClientObject.send(
                new SendMessageCommand({
                  QueueUrl: linkQueueUrl,
                  MessageBody: JSON.stringify({
                    ssoParams: {
                      ...staticSSOPayload,
                      PrincipalId: principalId,
                      PermissionSetArn: message.permission_set_arn,
                      TargetId: Item.awsEntityData,
                    },
                    actionType: "create",
                    entityType: Item.awsEntityType,
                    tagKeyLookUp: "none",
                    sourceRequestId: requestId,
                  }),
                  MessageGroupId: Item.awsEntityData.slice(-1),
                })
              );
              logger({
                handler: "permissionSetSyncHandler",
                logMode: "info",
                relatedData: `${message.permission_set_name}`,
                status: requestStatus.Completed,
                requestId: requestId,
                statusMessage: `Permission Set sync - posted to link manager topic`,
              });
            } else if (
              Item.awsEntityType === "ou_id" ||
              Item.awsEntityType === "root" ||
              Item.awsEntityType === "account_tag"
            ) {
              const stateMachinePayload: StateMachinePayload = {
                action: "create",
                entityType: Item.awsEntityType,
                instanceArn: staticSSOPayload.InstanceArn,
                permissionSetArn: message.permission_set_arn,
                principalId: principalId,
                principalType: staticSSOPayload.PrincipalType,
                targetType: staticSSOPayload.TargetType,
                topicArn: processTargetAccountSMTopicArn + "",
                sourceRequestId: requestId,
                pageSize: 5,
                waitSeconds: 2,
                supportNestedOU: supportNestedOU + "",
              };
              await invokeStepFunction(
                stateMachinePayload,
                Item.awsEntityData,
                processTargetAccountSMArn + "",
                sfnClientObject
              );
              logger({
                handler: "permissionSetSyncHandler",
                logMode: "info",
                relatedData: `${message.permission_set_name}`,
                requestId: requestId,
                status: requestStatus.Completed,
                statusMessage: `Permission Set sync - posted to step function`,
              });
            }
          } else {
            logger({
              handler: "permissionSetSyncHandler",
              logMode: "info",
              relatedData: `${message.permission_set_name}`,
              requestId: requestId,
              status: requestStatus.Completed,
              statusMessage: `Permission Set sync - no related principals found`,
            });
          }
        })
      );
    } else {
      logger({
        handler: "permissionSetSyncHandler",
        logMode: "info",
        relatedData: `${message.permission_set_name}`,
        requestId: requestId,
        status: requestStatus.Completed,
        statusMessage: `Permission Set sync - ignoring operation as there are no related links already provisioined for this permission set`,
      });
    }
  } catch (err) {
    await snsClientObject.send(
      new PublishCommand({
        TopicArn: errorNotificationsTopicArn,
        Message: JSON.stringify({
          ...errorMessage,
          eventDetail: event,
          errorDetails: err,
        }),
      })
    );
    logger({
      handler: "permissionSetSyncHandler",
      logMode: "error",
      status: requestStatus.FailedWithException,
      requestId: requestId,
      statusMessage: `permission set sync processor failed with exception: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`,
    });
  }
};

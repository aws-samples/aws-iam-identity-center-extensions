/*
Objective: Implement permission set sync
Trigger source: Permission set sync notification
                which in turn is triggered by permission
                set stream handler when it determines that
                there is a permission set being created/updated
                that has not yet been provisioned
- assumes role in SSO account for calling SSO admin API
- fetches if there are links provisioned already
  for the permission set in the links table
    - if the links are already provisioned,
      then determine whether the group is
      already provisioned
        - if the group is provisioned,
          determine the entity type
          - resolve the actual accounts
            if entity type is root , account_tag or ou_id
          - post the link operation messages
            to link manager topic
        - if the group is not yet provisioned,
           determine if AD config is being used
           and resolve the just-in-time group ID
           - Resolve the actual accounts and post
             the link operation messages to link
             manager topic
        - if AD config is not being used, then stop
          the process here
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

const {
  linksTableName,
  linkQueueUrl,
  groupsTableName,
  adUsed,
  domainName,
  SSOAPIRoleArn,
  ISAPIRoleArn,
  processTargetAccountSMInvokeRoleArn,
  processTargetAccountSMTopicArn,
  processTargetAccountSMArn,
  errorNotificationsTopicArn,
  ssoRegion,
  AWS_REGION,
} = process.env;

// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  IdentitystoreClient,
  ListGroupsCommand,
  ListGroupsCommandOutput,
} from "@aws-sdk/client-identitystore";
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
  PutCommand,
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
import { invokeStepFunction, logger } from "../../helpers/src/utilities";
// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION });
const sqsClientObject = new SQSClient({ region: AWS_REGION });

const ssoAdminClientObject = new SSOAdminClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: SSOAPIRoleArn,
    },
  }),
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
      RoleArn: processTargetAccountSMInvokeRoleArn,
    },
  }),
});

//Error notification
const errorMessage: ErrorMessage = {
  Subject: "Error Processing link stream handler",
};

export const handler = async (event: SNSEvent) => {
  const requestId = uuidv4().toString();
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const relatedLinks: QueryCommandOutput = await ddbDocClientObject.send(
      // QueryCommand is a pagniated call, however the logic requires
      // checking only if the result set is greater than 0
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
      const staticSSOPayload: StaticSSOPayload = {
        InstanceArn: instanceArn,
        TargetType: "AWS_ACCOUNT",
        PrincipalType: "GROUP",
      };

      await Promise.all(
        relatedLinks.Items.map(async (Item) => {
          const relatedGroups: QueryCommandOutput =
            await ddbDocClientObject.send(
              // QueryCommand is a pagniated call, however the logic requires
              // checking only if the result set is greater than 0
              new QueryCommand({
                TableName: groupsTableName,
                IndexName: "groupName",
                KeyConditionExpression: "#groupname = :groupname",
                ExpressionAttributeNames: { "#groupname": "groupName" },
                ExpressionAttributeValues: { ":groupname": Item.groupName },
              })
            );
          if (relatedGroups.Items && relatedGroups.Items.length !== 0) {
            if (Item.awsEntityType === "account") {
              await sqsClientObject.send(
                new SendMessageCommand({
                  QueueUrl: linkQueueUrl,
                  MessageBody: JSON.stringify({
                    ssoParams: {
                      ...staticSSOPayload,
                      PrincipalId: relatedGroups.Items[0].groupId,
                      PermissionSetArn: message.permission_set_arn,
                      TargetId: Item.awsEntityData,
                    },
                    actionType: "create",
                    entityType: Item.awsEntityType,
                    tagKeyLookUp: "none",
                    sourceRequestId: requestId,
                  }),
                  MessageDeduplicationId: `create-${Item.awsEntityData}-${
                    message.permission_set_arn.toString().split("/")[2]
                  }-${relatedGroups.Items[0].groupId}`,
                  MessageGroupId: `${Item.awsEntityData}-${
                    message.permission_set_arn.toString().split("/")[2]
                  }-${relatedGroups.Items[0].groupId}`,
                })
              );
              logger({
                handler: "permissionSetSyncHandler",
                logMode: "info",
                requestId: requestId,
                relatedData: `${message.permission_set_name}`,
                status: requestStatus.Completed,
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
                principalId: relatedGroups.Items[0].groupId,
                principalType: staticSSOPayload.PrincipalType,
                targetType: staticSSOPayload.TargetType,
                topicArn: processTargetAccountSMTopicArn + "",
                sourceRequestId: requestId,
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
          } else if (adUsed === "true" && domainName !== "") {
            // Handling AD sync as the group does not yet exist within DDB
            const identityStoreId =
              resolvedInstances.Instances?.[0].IdentityStoreId;
            const listGroupsResult: ListGroupsCommandOutput =
              await identityStoreClientObject.send(
                new ListGroupsCommand({
                  IdentityStoreId: identityStoreId,
                  Filters: [
                    {
                      AttributePath: "DisplayName",
                      AttributeValue: `${Item.groupName}@${domainName}`,
                    },
                  ],
                })
              );

            if (
              listGroupsResult.Groups &&
              listGroupsResult.Groups.length !== 0
            ) {
              // Resolved the AD group ID and proceeding with the operation
              await ddbDocClientObject.send(
                new PutCommand({
                  TableName: groupsTableName,
                  Item: {
                    groupName: Item.groupName,
                    groupId: listGroupsResult.Groups[0].GroupId,
                  },
                })
              );
              if (Item.awsEntityType === "account") {
                await sqsClientObject.send(
                  new SendMessageCommand({
                    QueueUrl: linkQueueUrl,
                    MessageBody: JSON.stringify({
                      ssoParams: {
                        ...staticSSOPayload,
                        PrincipalId: listGroupsResult.Groups[0].GroupId,
                        PermissionSetArn: message.permission_set_arn,
                        TargetId: Item.awsEntityData,
                      },
                      actionType: "create",
                      entityType: Item.awsEntityType,
                      tagKeyLookUp: "none",
                      sourceRequestId: requestId,
                    }),
                    MessageDeduplicationId: `create-${Item.awsEntityData}-${
                      message.permission_set_arn.toString().split("/")[2]
                    }-${listGroupsResult.Groups[0].GroupId}`,
                    MessageGroupId: `${Item.awsEntityData}-${
                      message.permission_set_arn.toString().split("/")[2]
                    }-${listGroupsResult.Groups[0].GroupId}`,
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
                  principalId: listGroupsResult.Groups[0].GroupId + "",
                  principalType: staticSSOPayload.PrincipalType,
                  targetType: staticSSOPayload.TargetType,
                  topicArn: processTargetAccountSMTopicArn + "",
                  sourceRequestId: requestId,
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
              // No related groups found from AD sync for this link
              logger({
                handler: "permissionSetSyncHandler",
                logMode: "info",
                relatedData: `${message.permission_set_name}`,
                requestId: requestId,
                status: requestStatus.Completed,
                statusMessage: `Permission Set sync - no related groups found`,
              });
            }
          } else {
            // Ignoring permission set sync for the link as the group is not yet provisioned
            logger({
              handler: "permissionSetSyncHandler",
              logMode: "info",
              relatedData: `${message.permission_set_name}`,
              requestId: requestId,
              status: requestStatus.Completed,
              statusMessage: `Permission Set sync - ignoring operation as group is not yet provisioned`,
            });
          }
        })
      );
    } else {
      // Ignoring permission set sync as there are no
      // related links already provisioined for this permission set
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

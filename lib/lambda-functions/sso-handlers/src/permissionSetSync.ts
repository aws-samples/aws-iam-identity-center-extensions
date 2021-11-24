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
  linkManagerTopicArn,
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
import {
  ErrorMessage,
  StateMachinePayload,
  StaticSSOPayload,
} from "../../helpers/src/interfaces";
import { invokeStepFunction } from "../../helpers/src/utilities";

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION });

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
              await snsClientObject.send(
                new PublishCommand({
                  TopicArn: linkManagerTopicArn,
                  Message: JSON.stringify({
                    ssoParams: {
                      ...staticSSOPayload,
                      PrincipalId: relatedGroups.Items[0].groupId,
                      PermissionSetArn: message.permission_set_arn,
                      TargetId: Item.awsEntityData,
                    },
                    actionType: "create",
                    entityType: Item.awsEntityType,
                    tagKeyLookUp: "none",
                  }),
                })
              );
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
              };
              await invokeStepFunction(
                stateMachinePayload,
                Item.awsEntityData,
                processTargetAccountSMArn + "",
                sfnClientObject
              );
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
                await snsClientObject.send(
                  new PublishCommand({
                    TopicArn: linkManagerTopicArn,
                    Message: JSON.stringify({
                      ssoParams: {
                        ...staticSSOPayload,
                        PrincipalId: listGroupsResult.Groups[0].GroupId,
                        PermissionSetArn: message.permission_set_arn,
                        TargetId: Item.awsEntityData,
                      },
                      actionType: "create",
                      entityType: Item.awsEntityType,
                      tagKeyLookUp: "none",
                    }),
                  })
                );
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
                };
                await invokeStepFunction(
                  stateMachinePayload,
                  Item.awsEntityData,
                  processTargetAccountSMArn + "",
                  sfnClientObject
                );
              }
            } else {
              // No related groups found from AD sync for this link
              console.log(`No related groups found from AD sync for this link`);
            }
          } else {
            // Ignoring permission set sync for the link as the group is not yet provisioned
            console.log(
              `Ignoring permission set sync for the link as the group is not yet provisioned`
            );
          }
        })
      );
    } else {
      // Ignoring permission set sync as there are no
      // related links already provisioined for this permission set
      console.log(
        `Ignoring permission set sync as there are no related links already provisioined for this permission set`
      );
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
    console.error(
      `Exception when processing permission set sync: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`
    );
  }
};

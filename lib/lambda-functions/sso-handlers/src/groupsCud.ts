/*
Objective: Implement SSO group events handler for processing groups
Trigger source: SSO group changes notification topic which in turn
                receives event bridge notifications from SSO account
                for group changes
- assumes role in SSO account for calling SSO admin API - listInstances
- determine if the event type is create or delete
- determine the group name (SSO uses
      different event schemas for this
      event depending on the identity store)
- if create/delete
  - upsert/delete into groups DDB table
  - determine if there are related links
    already provisioned by looking up
    links table
  - if there are related links, then
    - for each related link
    - determine if permission set referenced
      in the link is already provisioned by
      looking up permissionsetArn ddb table
        - if permission set is already
          provisioned, then
            - determine if the link type is
              account, ou_id, account_tag or root
            - if account, post the link
              operation details to link manager
              topic
            - if ou_id, root, account_tag resolve the
              actual accounts and post the link
              operation details to the link manager
              topic, one message per account
        - if permission set is not provisioned,
          stop the operation here
    - if there are no related links, then
      stop the operation here
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

// Environment configuration read
const {
  SSOAPIRoleArn,
  DdbTable,
  processTargetAccountSMInvokeRoleArn,
  processTargetAccountSMTopicArn,
  processTargetAccountSMArn,
  permissionarntable,
  linkstable,
  topicArn,
  errorNotificationsTopicArn,
  ssoRegion,
  AWS_REGION,
} = process.env;

// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SFNClient } from "@aws-sdk/client-sfn";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import {
  ListInstancesCommand,
  ListInstancesCommandOutput,
  SSOAdminClient,
} from "@aws-sdk/client-sso-admin";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
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
  Subject: "Error Processing group trigger based link provisioning operation",
};

export const handler = async (event: SNSEvent) => {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn;
    const staticSSOPayload: StaticSSOPayload = {
      InstanceArn: instanceArn + "",
      TargetType: "AWS_ACCOUNT",
      PrincipalType: "GROUP",
    };

    let groupId = "";
    let groupName = "";

    if (message.detail.eventName === "CreateGroup") {
      groupId = message.detail.responseElements.group.groupId;
      // To handle SSO generating cloudwatch events with different formats
      // depending on the identity store being used
      if (
        Object.prototype.hasOwnProperty.call(
          message.detail.responseElements.group,
          "displayName"
        )
      ) {
        groupName = message.detail.responseElements.group.displayName;
      } else if (
        Object.prototype.hasOwnProperty.call(
          message.detail.responseElements.group,
          "groupName"
        )
      ) {
        groupName = message.detail.responseElements.group.groupName;
      }
      await ddbDocClientObject.send(
        new PutCommand({
          TableName: DdbTable,
          Item: {
            groupName: groupName,
            groupId: groupId,
          },
        })
      );

      console.log(
        `In ssogroups handler, resolved groupName as ${groupName} and processed DDB table upsert`
      );

      const relatedLinks: QueryCommandOutput = await ddbDocClientObject.send(
        // QueryCommand is a pagniated call, however the logic requires
        // checking only if the result set is greater than 0
        new QueryCommand({
          TableName: linkstable,
          IndexName: "groupName",
          KeyConditionExpression: "#groupname = :groupname",
          ExpressionAttributeNames: { "#groupname": "groupName" },
          ExpressionAttributeValues: { ":groupname": groupName },
        })
      );

      if (relatedLinks.Items && relatedLinks.Items?.length !== 0) {
        await Promise.all(
          relatedLinks.Items?.map(async (Item) => {
            const { awsEntityType, awsEntityData, permissionSetName } = Item;
            const permissionSetFetch: GetCommandOutput =
              await ddbDocClientObject.send(
                new GetCommand({
                  TableName: permissionarntable,
                  Key: {
                    permissionSetName: permissionSetName,
                  },
                })
              );
            if (permissionSetFetch.Item) {
              const { permissionSetArn } = permissionSetFetch.Item;
              if (awsEntityType === "account") {
                await snsClientObject.send(
                  new PublishCommand({
                    TopicArn: topicArn,
                    Message: JSON.stringify({
                      ssoParams: {
                        ...staticSSOPayload,
                        TargetId: awsEntityData,
                        PermissionSetArn: permissionSetArn,
                        PrincipalId: groupId,
                      },
                      actionType: "create",
                      entityType: awsEntityType,
                      tagKeyLookUp: "none",
                    }),
                  })
                );
              } else if (
                awsEntityType === "ou_id" ||
                awsEntityType === "root" ||
                awsEntityType === "account_tag"
              ) {
                const stateMachinePayload: StateMachinePayload = {
                  action: "create",
                  entityType: awsEntityType,
                  instanceArn: staticSSOPayload.InstanceArn,
                  permissionSetArn: permissionSetArn,
                  principalId: groupId,
                  principalType: staticSSOPayload.PrincipalType,
                  targetType: staticSSOPayload.TargetType,
                  topicArn: processTargetAccountSMTopicArn + "",
                };
                await invokeStepFunction(
                  stateMachinePayload,
                  awsEntityData,
                  processTargetAccountSMArn + "",
                  sfnClientObject
                );
              }
            } else {
              // Permission set for the group-link does not exist
            }
          })
        );
        console.log(
          `In ssogroups handler, related links found for groupName ${groupName}`
        );
      } else {
        // No related links for the group being processed
      }
    } else if (message.detail.eventName === "DeleteGroup") {
      groupId = message.detail.requestParameters.groupId;
      const groupFetch: GetCommandOutput = await ddbDocClientObject.send(
        new GetCommand({
          TableName: DdbTable,
          Key: {
            groupId: groupId,
          },
        })
      );
      if (groupFetch.Item) {
        groupName = groupFetch.Item.groupName;
        // QueryCommand is a pagniated call, however the logic requires
        // checking only if the result set is greater than 0
        const relatedLinks: QueryCommandOutput = await ddbDocClientObject.send(
          new QueryCommand({
            TableName: linkstable,
            IndexName: "groupName",
            KeyConditionExpression: "#groupname = :groupname",
            ExpressionAttributeNames: { "#groupname": "groupName" },
            ExpressionAttributeValues: { ":groupname": groupName },
          })
        );

        if (relatedLinks.Items && relatedLinks.Items?.length !== 0) {
          // Received groupDelete where the group has existing links.
          // These links would become orphaned and not accessbile anymore,
          // therefore deleting them
          await Promise.all(
            relatedLinks.Items.map(async (Item) => {
              await ddbDocClientObject.send(
                new DeleteCommand({
                  TableName: linkstable,
                  Key: {
                    awsEntityId: Item.awsEntityId,
                  },
                })
              );
            })
          );

          console.log(
            `In ssogroups handler, resolved groupName as ${groupName} and processed DDB table deletion`
          );
        } else {
          // No related links for the group being deleted
        }
        await ddbDocClientObject.send(
          new DeleteCommand({
            TableName: DdbTable,
            Key: {
              groupId: groupId,
            },
          })
        );
      } else {
        // The group does not exist, so not deleting again
      }
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
      `Exception when processing group event notifications: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`
    );
  }
};

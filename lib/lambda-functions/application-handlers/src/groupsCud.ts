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
  linkQueueUrl,
  errorNotificationsTopicArn,
  ssoRegion,
  AWS_REGION,
} = process.env;

// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SFNClient } from "@aws-sdk/client-sfn";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
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
  requestStatus,
  StateMachinePayload,
  StaticSSOPayload,
} from "../../helpers/src/interfaces";
import { invokeStepFunction, logger } from "../../helpers/src/utilities";
import { v4 as uuidv4 } from "uuid";
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
  const requestId = uuidv4().toString();
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

      logger({
        handler: "groupsHandler",
        logMode: "info",
        requestId: requestId,
        relatedData: `${groupName}`,
        status: requestStatus.InProgress,
        statusMessage: `CreateGroup operation - resolved groupName and processed DDB table upsert`,
      });

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
                await sqsClientObject.send(
                  new SendMessageCommand({
                    QueueUrl: linkQueueUrl,
                    MessageBody: JSON.stringify({
                      ssoParams: {
                        ...staticSSOPayload,
                        TargetId: awsEntityData,
                        PermissionSetArn: permissionSetArn,
                        PrincipalId: groupId,
                      },
                      actionType: "create",
                      entityType: awsEntityType,
                      tagKeyLookUp: "none",
                      sourceRequestId: requestId,
                    }),
                    MessageDeduplicationId: `create-${awsEntityData}-${
                      permissionSetArn.toString().split("/")[2]
                    }-${groupId}`,
                    MessageGroupId: `${awsEntityData}-${
                      permissionSetArn.toString().split("/")[2]
                    }-${groupId}`,
                  })
                );
                logger({
                  handler: "groupsHandler",
                  logMode: "info",
                  relatedData: `${groupName}`,
                  requestId: requestId,
                  status: requestStatus.Completed,
                  statusMessage: `CreateGroup operation - triggered account assignment provisioning operation`,
                });
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
                  sourceRequestId: requestId,
                };
                await invokeStepFunction(
                  stateMachinePayload,
                  awsEntityData,
                  processTargetAccountSMArn + "",
                  sfnClientObject
                );
                logger({
                  handler: "groupsHandler",
                  logMode: "info",
                  relatedData: `${groupName}`,
                  requestId: requestId,
                  status: requestStatus.Completed,
                  statusMessage: `CreateGroup operation - triggered step function for org based resolution`,
                });
              }
            } else {
              // Permission set for the group-link does not exist
              logger({
                handler: "groupsHandler",
                logMode: "info",
                relatedData: `${groupName}`,
                requestId: requestId,
                status: requestStatus.Completed,
                statusMessage: `CreateGroup operation - permission set referenced in related account assignments not found`,
              });
            }
          })
        );
      } else {
        // No related links for the group being processed
        logger({
          handler: "groupsHandler",
          logMode: "info",
          relatedData: `${groupName}`,
          requestId: requestId,
          status: requestStatus.Completed,
          statusMessage: `CreateGroup operation - no related account assignments found for the group`,
        });
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
              logger({
                handler: "groupsHandler",
                logMode: "info",
                requestId: requestId,
                relatedData: `${groupName}`,
                status: requestStatus.Completed,
                statusMessage: `DeleteGroup operation - Deleting related link as the link would be orphaned : ${Item.awsEntityId}`,
              });
            })
          );
        } else {
          // No related links for the group being deleted
          logger({
            handler: "groupsHandler",
            logMode: "info",
            relatedData: `${groupName}`,
            requestId: requestId,
            status: requestStatus.Completed,
            statusMessage: `DeleteGroup operation - no related account assignments found for the group being deleted`,
          });
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
        logger({
          handler: "groupsHandler",
          logMode: "info",
          relatedData: `${groupName}`,
          requestId: requestId,
          status: requestStatus.Completed,
          statusMessage: `DeleteGroup operation - group does not exist, so not deleting again`,
        });
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
    logger({
      handler: "groupsHandler",
      logMode: "error",
      requestId: requestId,
      status: requestStatus.FailedWithException,
      statusMessage: `Groups operation - failed with exception: ${JSON.stringify(
        err
      )} for eventDetail: ${event}`,
    });
  }
};

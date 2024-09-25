/**
 * Objective: Implement SSO group events handler for processing groups Trigger.
 * Source: SSO group changes notification topic which in turn receives event
 * bridge notifications from SSO account for group changes.
 *
 * - Assumes role in SSO account for calling SSO admin API - listInstances.
 * - Determine if the event type is create or delete.
 * - Determine the group name (SSO uses different event schemas for this event
 *   depending on the identity store).
 * - If create/delete:
 * - Determine if there are related links already provisioned by looking up links
 *   table.
 * - If there are related links:
 * - For each related link:
 * - Determine if permission set referenced in the link is already provisioned by
 *   looking up permissionsetArn ddb table.
 * - If permission set is already provisioned:
 * - Determine if the link type is account, ou_id, account_tag or root.
 * - If account, post the link operation details to link manager FIFO queue.
 * - If ou_id, root, account_tag resolve the actual accounts and post the link
 *   operation details to org entities state machine in org account.
 * - If permission set is not provisioned, stop the operation here.
 * - If there are no related links, then stop the operation here.
 * - Catch all failures in a generic exception block and post the error details to
 *   error notifications topics.
 */

const {
  SSOAPIRoleArn,
  orgListSMRoleArn,
  processTargetAccountSMTopicArn,
  processTargetAccountSMArn,
  permissionarntable,
  linkstable,
  linkQueueUrl,
  errorNotificationsTopicArn,
  ssoRegion,
  supportNestedOU,
  AWS_REGION,
  functionLogMode,
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;

import {
  DynamoDBClient,
  DynamoDBServiceException,
} from "@aws-sdk/client-dynamodb";
import { SFNClient, SFNServiceException } from "@aws-sdk/client-sfn";
import {
  PublishCommand,
  SNSClient,
  SNSServiceException,
} from "@aws-sdk/client-sns";
import {
  SendMessageCommand,
  SQSClient,
  SQSServiceException,
} from "@aws-sdk/client-sqs";
import {
  ListInstancesCommand,
  ListInstancesCommandOutput,
  SSOAdminClient,
} from "@aws-sdk/client-sso-admin";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import {
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
  QueryCommand,
  QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { SNSEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  logModes,
  requestStatus,
  StateMachinePayload,
  StaticSSOPayload,
} from "../../helpers/src/interfaces";
import {
  constructExceptionMessage,
  constructExceptionMessageforLogger,
  invokeStepFunction,
  logger,
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
const sfnClientObject = new SFNClient({
  region: "us-east-1",
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: orgListSMRoleArn,
    },
  }),
  maxAttempts: 2,
});

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
const messageSubject =
  "Exception in AWS IAM Identity Center group event processing logic";
let groupNameValue = "";

export const handler = async (event: SNSEvent) => {
  const requestId = uuidv4().toString();
  logger(
    {
      handler: handlerName,
      logMode: logModes.Info,
      requestId: requestId,
      status: requestStatus.InProgress,
      statusMessage: `SSO group event triggered event bridge rule, started processing`,
    },
    functionLogMode,
  );
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));
    logger(
      {
        handler: handlerName,
        logMode: logModes.Debug,
        requestId: requestId,
        status: requestStatus.InProgress,
        statusMessage: `Resolved SSO instance arn`,
      },
      functionLogMode,
    );
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn;
    const staticSSOPayload: StaticSSOPayload = {
      InstanceArn: instanceArn + "",
      TargetType: "AWS_ACCOUNT",
      PrincipalType: "GROUP",
    };

    let groupId = "";
    let groupName = "";

    if (message.detail.eventName === "CreateGroup") {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          status: requestStatus.InProgress,
          statusMessage: `Determined event is CreateGroup`,
        },
        functionLogMode,
      );
      groupId = message.detail.responseElements.group.groupId;
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          status: requestStatus.InProgress,
          relatedData: groupId,
          statusMessage: `Set groupID value as read from the event payload`,
        },
        functionLogMode,
      );
      /**
       * To handle SSO generating cloudwatch events with different formats
       * depending on the identity store being used
       */

      if (
        Object.prototype.hasOwnProperty.call(
          message.detail.responseElements.group,
          "displayName",
        )
      ) {
        groupName = message.detail.responseElements.group.displayName;
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            relatedData: groupId,
            statusMessage: `Event sent displayName value for groupName, using this value - ${groupName}`,
          },
          functionLogMode,
        );
      } else if (
        Object.prototype.hasOwnProperty.call(
          message.detail.responseElements.group,
          "groupName",
        )
      ) {
        groupName = message.detail.responseElements.group.groupName;
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            relatedData: groupId,
            statusMessage: `Event sent groupName value for groupName, using this value - ${groupName}`,
          },
          functionLogMode,
        );
      }
      groupNameValue = groupName;
      const relatedLinks: QueryCommandOutput = await ddbDocClientObject.send(
        /**
         * QueryCommand is a pagniated call, however the logic requires checking
         * only if the result set is greater than 0
         */

        new QueryCommand({
          TableName: linkstable,
          IndexName: "principalName",
          KeyConditionExpression: "#principalName = :principalName",
          ExpressionAttributeNames: { "#principalName": "principalName" },
          ExpressionAttributeValues: { ":principalName": groupName },
        }),
      );
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          status: requestStatus.InProgress,
          relatedData: groupId,
          statusMessage: `Querying if there are any related account assignments for group ${groupName}`,
        },
        functionLogMode,
      );

      if (relatedLinks.Items && relatedLinks.Items?.length !== 0) {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.InProgress,
            relatedData: groupId,
            statusMessage: `Determined there are ${relatedLinks.Items.length} no of account assignments for group ${groupName}`,
          },
          functionLogMode,
        );
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
                }),
              );
            if (permissionSetFetch.Item) {
              const { permissionSetArn } = permissionSetFetch.Item;
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Debug,
                  requestId: requestId,
                  status: requestStatus.InProgress,
                  relatedData: groupId,
                  statusMessage: `Determined permission set ${permissionSetName} for the account assignments is provisioned already with permissionSetArn ${permissionSetArn}`,
                },
                functionLogMode,
              );

              if (awsEntityType === "account") {
                logger(
                  {
                    handler: handlerName,
                    logMode: logModes.Debug,
                    requestId: requestId,
                    status: requestStatus.InProgress,
                    relatedData: groupId,
                    statusMessage: `Determined entity type is account for this account assignment type`,
                  },
                  functionLogMode,
                );

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
                    MessageGroupId: awsEntityData.slice(-1),
                  }),
                );
                logger(
                  {
                    handler: handlerName,
                    logMode: logModes.Info,
                    requestId: requestId,
                    status: requestStatus.InProgress,
                    relatedData: groupId,
                    statusMessage: `Sent payload to account assignment queue with account ID ${awsEntityData}, for permissionSetArn ${permissionSetArn} and group ${groupName}`,
                  },
                  functionLogMode,
                );
              } else if (
                awsEntityType === "ou_id" ||
                awsEntityType === "root" ||
                awsEntityType === "account_tag"
              ) {
                logger(
                  {
                    handler: handlerName,
                    logMode: logModes.Debug,
                    requestId: requestId,
                    status: requestStatus.InProgress,
                    relatedData: groupId,
                    statusMessage: `Determined entity type is ${awsEntityType} for this account assignment type`,
                  },
                  functionLogMode,
                );
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
                  pageSize: 5,
                  waitSeconds: 2,
                  supportNestedOU: supportNestedOU + "",
                };
                await invokeStepFunction(
                  stateMachinePayload,
                  awsEntityData,
                  processTargetAccountSMArn + "",
                  sfnClientObject,
                );
                logger(
                  {
                    handler: handlerName,
                    logMode: logModes.Info,
                    requestId: requestId,
                    status: requestStatus.InProgress,
                    relatedData: groupId,
                    statusMessage: `Invoked state machine for procesing group event with entityType ${awsEntityType} for groupID ${groupId} , permissionSetArn ${permissionSetArn} , targetType ${staticSSOPayload.TargetType} and entityData ${awsEntityData} `,
                  },
                  functionLogMode,
                );
              }
            } else {
              /** Permission set for the group-link does not exist */
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestId,
                  status: requestStatus.Aborted,
                  relatedData: groupId,
                  statusMessage: `Determined that permissionSet ${permissionSetName} does not yet exist in the solution, so aborting the operation`,
                },
                functionLogMode,
              );
            }
          }),
        );
      } else {
        /** No related links for the group being processed */
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.Aborted,
            relatedData: groupId,
            statusMessage: `Determined that there are no related account assignments for this group, aborting the operation`,
          },
          functionLogMode,
        );
      }
    } else if (message.detail.eventName === "DeleteGroup") {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          status: requestStatus.Aborted,
          statusMessage: `Determined event is DeleteGroup, no actions being done as the group is deletec directly`,
        },
        functionLogMode,
      );
    }
  } catch (err) {
    if (
      err instanceof DynamoDBServiceException ||
      err instanceof SFNServiceException ||
      err instanceof SNSServiceException ||
      err instanceof SQSServiceException
    ) {
      await snsClientObject.send(
        new PublishCommand({
          TopicArn: errorNotificationsTopicArn,
          Subject: messageSubject,
          Message: constructExceptionMessage(
            requestId,
            handlerName,
            err.name,
            err.message,
            groupNameValue,
          ),
        }),
      );
      logger({
        handler: handlerName,
        requestId: requestId,
        logMode: logModes.Exception,
        status: requestStatus.FailedWithException,
        statusMessage: constructExceptionMessageforLogger(
          requestId,
          err.name,
          err.message,
          groupNameValue,
        ),
      });
    } else {
      await snsClientObject.send(
        new PublishCommand({
          TopicArn: errorNotificationsTopicArn,
          Subject: messageSubject,
          Message: constructExceptionMessage(
            requestId,
            handlerName,
            "Unhandled exception",
            JSON.stringify(err),
            groupNameValue,
          ),
        }),
      );
      logger({
        handler: handlerName,
        requestId: requestId,
        logMode: logModes.Exception,
        status: requestStatus.FailedWithException,
        statusMessage: constructExceptionMessageforLogger(
          requestId,
          "Unhandled exception",
          JSON.stringify(err),
          groupNameValue,
        ),
      });
    }
  }
};

/**
 * Objective: Implement SSO user events handler for processing groups Trigger
 * source: SSO user changes notification topic which in turn receives event
 * bridge notifications from SSO account for group changes
 *
 * - Assumes role in SSO account for calling SSO admin API - listInstances
 * - Determine if the event type is create or delete
 * - Determine the user name
 * - Process the appropriate links
 * - Catch all failures in a generic exception block and post the error details to
 *   error notifications topics
 */

// Environment configuration read
const {
  SSOAPIRoleArn,
  ISAPIRoleArn,
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
import {
  DescribeUserCommand,
  DescribeUserCommandOutput,
  IdentitystoreClient,
  IdentitystoreServiceException,
} from "@aws-sdk/client-identitystore";
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
  SSOAdminServiceException,
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
const identityStoreClientObject = new IdentitystoreClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: ISAPIRoleArn,
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
const messageSubject = "Exception in processing user CRUD triggered processing";
let eventDetailValue = "";

export const handler = async (event: SNSEvent) => {
  const requestId = uuidv4().toString();
  const message = JSON.parse(event.Records[0].Sns.Message);
  eventDetailValue = `${message.detail.eventName}`;
  try {
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestId,
        relatedData: eventDetailValue,
        status: requestStatus.InProgress,
        statusMessage: `Processing user CRUD triggered operaiton ${eventDetailValue}`,
      },
      functionLogMode
    );

    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn;
    const identityStoreId = resolvedInstances.Instances?.[0].IdentityStoreId;
    logger(
      {
        handler: handlerName,
        logMode: logModes.Debug,
        requestId: requestId,
        relatedData: eventDetailValue,
        status: requestStatus.InProgress,
        statusMessage: `Resolved instanceArn as ${instanceArn} and identityStoreId as ${identityStoreId}`,
      },
      functionLogMode
    );

    const staticSSOPayload: StaticSSOPayload = {
      InstanceArn: instanceArn + "",
      TargetType: "AWS_ACCOUNT",
      PrincipalType: "USER",
    };

    let userId = "";
    let userName = "";

    if (message.detail.eventName === "CreateUser") {
      userId = message.detail.responseElements.user.userId;
    } else if (message.detail.eventName === "DeleteUser") {
      userId = message.detail.requestParameters.userId;
    }
    eventDetailValue = `${message.detail.eventName}-${userId}`;
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestId,
        relatedData: eventDetailValue,
        status: requestStatus.InProgress,
        statusMessage: `Determined ${message.detail.eventName} operation is triggered for user ${userId}`,
      },
      functionLogMode
    );

    const describeUserResult: DescribeUserCommandOutput =
      await identityStoreClientObject.send(
        new DescribeUserCommand({
          IdentityStoreId: identityStoreId,
          UserId: userId,
        })
      );
    if (describeUserResult) {
      userName = describeUserResult.UserName + "";
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          relatedData: eventDetailValue,
          status: requestStatus.InProgress,
          statusMessage: `Determined ${message.detail.eventName} operation is triggered for user ${userId} with userName ${userName}`,
        },
        functionLogMode
      );
    }

    eventDetailValue = `${message.detail.eventName}-${userId}-${userName}`;
    if (message.detail.eventName === "CreateUser") {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          relatedData: eventDetailValue,
          status: requestStatus.InProgress,
          statusMessage: `Triggering logic for ${message.detail.eventName} operation with user ${userId} and user name ${userName}`,
        },
        functionLogMode
      );

      const relatedLinks: QueryCommandOutput = await ddbDocClientObject.send(
        // QueryCommand is a pagniated call, however the logic requires
        // checking only if the result set is greater than 0
        new QueryCommand({
          TableName: linkstable,
          IndexName: "principalName",
          KeyConditionExpression: "#principalName = :principalName",
          ExpressionAttributeNames: { "#principalName": "principalName" },
          ExpressionAttributeValues: { ":principalName": userName },
        })
      );

      if (relatedLinks.Items && relatedLinks.Items?.length !== 0) {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            relatedData: eventDetailValue,
            status: requestStatus.InProgress,
            statusMessage: `Determined there are ${relatedLinks.Items.length} no of related links that are associated with this eventDetailValue`,
          },
          functionLogMode
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
                        PrincipalId: userId,
                      },
                      actionType: "create",
                      entityType: awsEntityType,
                      tagKeyLookUp: "none",
                      sourceRequestId: requestId,
                    }),
                    MessageGroupId: awsEntityData.slice(-1),
                  })
                );
                logger(
                  {
                    handler: handlerName,
                    logMode: logModes.Info,
                    requestId: requestId,
                    relatedData: eventDetailValue,
                    status: requestStatus.Completed,
                    statusMessage: `Sent create type payload to account assignment processing queue`,
                  },
                  functionLogMode
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
                  principalId: userId,
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
                  sfnClientObject
                );
                logger(
                  {
                    handler: handlerName,
                    logMode: logModes.Info,
                    requestId: requestId,
                    relatedData: eventDetailValue,
                    status: requestStatus.Completed,
                    statusMessage: `Sent create type payload to targetAccount state machine for resolving target account assignments`,
                  },
                  functionLogMode
                );
              }
            } else {
              // Permission set for the user-link does not exist
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestId,
                  relatedData: eventDetailValue,
                  status: requestStatus.Completed,
                  statusMessage: `Permission set ${permissionSetName} referenced in the assoicated link does not exist, so completing the operation`,
                },
                functionLogMode
              );
            }
          })
        );
      } else {
        // No related links for the user being processed
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            relatedData: eventDetailValue,
            status: requestStatus.Completed,
            statusMessage: `No related links found, so completing the operation`,
          },
          functionLogMode
        );
      }
    } else if (message.detail.eventName === "DeleteUser") {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          relatedData: eventDetailValue,
          status: requestStatus.Completed,
          statusMessage: `DeleteUser operation - no actions being done as the user is deleted directly`,
        },
        functionLogMode
      );
    }
  } catch (err) {
    if (
      err instanceof DynamoDBServiceException ||
      err instanceof IdentitystoreServiceException ||
      err instanceof SFNServiceException ||
      err instanceof SNSServiceException ||
      err instanceof SQSServiceException ||
      err instanceof SSOAdminServiceException
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
            eventDetailValue
          ),
        })
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
          eventDetailValue
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
            eventDetailValue
          ),
        })
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
          eventDetailValue
        ),
      });
    }
  }
};

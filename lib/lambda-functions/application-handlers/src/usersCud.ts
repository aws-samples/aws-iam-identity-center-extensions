/*
Objective: Implement SSO user events handler for processing groups
Trigger source: SSO user changes notification topic which in turn
                receives event bridge notifications from SSO account
                for group changes
- assumes role in SSO account for calling SSO admin API - listInstances
- determine if the event type is create or delete
- determine the user name
- Process the appropriate links
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
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
  AWS_REGION,
} = process.env;

// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DescribeUserCommand,
  DescribeUserCommandOutput,
  IdentitystoreClient,
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
  GetCommand,
  GetCommandOutput,
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

//Error notification
const errorMessage: ErrorMessage = {
  Subject:
    "Error Processing user create/delete trigger based link provisioning operation",
};

export const handler = async (event: SNSEvent) => {
  const requestId = uuidv4().toString();
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn;
    const identityStoreId = resolvedInstances.Instances?.[0].IdentityStoreId;
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
    const describeUserResult: DescribeUserCommandOutput =
      await identityStoreClientObject.send(
        new DescribeUserCommand({
          IdentityStoreId: identityStoreId,
          UserId: userId,
        })
      );
    if (describeUserResult) {
      userName = describeUserResult.UserName + "";
    }

    if (message.detail.eventName === "CreateUser") {
      logger({
        handler: "userHandler",
        logMode: "info",
        requestId: requestId,
        relatedData: `${userName}`,
        status: requestStatus.InProgress,
        statusMessage: `CreateUser operation - resolved userName`,
      });

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
                    MessageDeduplicationId: `create-${awsEntityData}-${
                      permissionSetArn.toString().split("/")[2]
                    }-${userId}`,
                    MessageGroupId: `${awsEntityData}-${
                      permissionSetArn.toString().split("/")[2]
                    }-${userId}`,
                  })
                );
                logger({
                  handler: "userHandler",
                  logMode: "info",
                  relatedData: `${userName}`,
                  requestId: requestId,
                  status: requestStatus.Completed,
                  statusMessage: `CreateUser operation - triggered account assignment provisioning operation`,
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
                  principalId: userId,
                  principalType: staticSSOPayload.PrincipalType,
                  targetType: staticSSOPayload.TargetType,
                  topicArn: processTargetAccountSMTopicArn + "",
                  sourceRequestId: requestId,
                  pageSize: 5,
                  waitSeconds: 2,
                };
                await invokeStepFunction(
                  stateMachinePayload,
                  awsEntityData,
                  processTargetAccountSMArn + "",
                  sfnClientObject
                );
                logger({
                  handler: "userHandler",
                  logMode: "info",
                  relatedData: `${userName}`,
                  requestId: requestId,
                  status: requestStatus.Completed,
                  statusMessage: `CreateUser operation - triggered step function for org based resolution`,
                });
              }
            } else {
              // Permission set for the user-link does not exist
              logger({
                handler: "userHandler",
                logMode: "info",
                relatedData: `${userName}`,
                requestId: requestId,
                status: requestStatus.Completed,
                statusMessage: `CreateUser operation - permission set referenced in related account assignments not found`,
              });
            }
          })
        );
      } else {
        // No related links for the user being processed
        logger({
          handler: "userHandler",
          logMode: "info",
          relatedData: `${userName}`,
          requestId: requestId,
          status: requestStatus.Completed,
          statusMessage: `CreateUser operation - no related account assignments found for the user`,
        });
      }
    } else if (message.detail.eventName === "DeleteUser") {
      logger({
        handler: "userHandler",
        logMode: "info",
        relatedData: `${userName}`,
        requestId: requestId,
        status: requestStatus.Completed,
        statusMessage: `DeleteUser operation - no actions being done as the user is deleted directly`,
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
      handler: "userHandler",
      logMode: "error",
      requestId: requestId,
      status: requestStatus.FailedWithException,
      statusMessage: `User operation - failed with exception: ${JSON.stringify(
        err
      )} for eventDetail: ${event}`,
    });
  }
};

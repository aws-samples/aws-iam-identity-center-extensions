/**
 * Objective: Implement link provisioning/deprovisioning operations Trigger
 * source: Link Manager SNS topic
 *
 * - Assumes role in SSO account for calling SSO admin API
 * - If the targetAccount is payerAccount, the operation is ignored as SSO Admin
 *   API does not allow this
 * - Determine if the link action type is create or delete
 * - If create
 *
 *   - Do a lookup into provisioned links table with the link partition key
 *   - If link already exists, stop the process
 *   - If link does not exist yet, call sso create account assignment operation
 *   - Wait until operation is complete/fail/time out
 *   - If operation is complete , update provisioned links table
 * - If delete
 *
 *   - Do a lookup into provisioned links table with the link partition key
 *   - If link does not exist, stop the process
 *   - If link exists, call sso delete account assignment operation
 *   - Wait until operation is complete/fail/time out
 *   - If operation is complete, delete item from provisioined links table
 * - Catch all failures in a generic exception block and post the error details to
 *   error notifications topics
 */

const {
  SSOAPIRoleArn,
  waiterHandlerSSOAPIRoleArn,
  ssoRegion,
  provisionedLinksTable,
  errorNotificationsTopicArn,
  payerAccount,
  AWS_REGION,
  functionLogMode,
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;

import {
  DynamoDBClient,
  DynamoDBServiceException,
} from "@aws-sdk/client-dynamodb";
import {
  PublishCommand,
  SNSClient,
  SNSServiceException,
} from "@aws-sdk/client-sns";
import {
  CreateAccountAssignmentCommand,
  CreateAccountAssignmentCommandOutput,
  DeleteAccountAssignmentCommand,
  DeleteAccountAssignmentCommandOutput,
  ListInstancesCommand,
  ListInstancesCommandOutput,
  SSOAdminClient,
  SSOAdminServiceException,
} from "@aws-sdk/client-sso-admin";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { SQSEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { waitUntilAccountAssignmentCreation } from "../../custom-waiters/src/waitUntilAccountAssignmentCreation";
import { waitUntilAccountAssignmentDeletion } from "../../custom-waiters/src/waitUntilAccountAssignmentDeletion";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import {
  constructExceptionMessage,
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";

const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });
const ssoAdminClientObject = new SSOAdminClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: SSOAPIRoleArn,
    },
  }),
  maxAttempts: 5 /** Aggressive retry to accommodate large no of account assignment processing */,
});
const ssoAdminWaiterClientObject = new SSOAdminClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: waiterHandlerSSOAPIRoleArn,
    },
  }),
  maxAttempts: 5 /** Aggressive retry to accommodate large no of account assignment processing */,
});

/** Pre-emptive delay function */
function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
const messageSubject = "Exception in account assignment queue processor";
let linksKeyValue = "";

export const handler = async (event: SQSEvent) => {
  await Promise.all(
    event.Records.map(async (record) => {
      const requestId = uuidv4().toString();
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          status: requestStatus.InProgress,
          statusMessage: `Started processing account assignment queue operation`,
        },
        functionLogMode
      );
      try {
        const message = JSON.parse(record.body);
        const { ssoParams } = message;
        const provisionedLinksKey = `${ssoParams.PrincipalId}@${
          ssoParams.TargetId
        }@${ssoParams.PermissionSetArn.split("/")[1]}@${
          ssoParams.PermissionSetArn.split("/")[2]
        }`;
        linksKeyValue = provisionedLinksKey;
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            relatedData: provisionedLinksKey,
            sourceRequestId: message.sourceRequestId,
            status: requestStatus.InProgress,
            statusMessage: `SSO group event triggered event bridge rule, started processing`,
          },
          functionLogMode
        );
        if (ssoParams.TargetId !== payerAccount) {
          logger(
            {
              handler: handlerName,
              logMode: logModes.Debug,
              requestId: requestId,
              relatedData: provisionedLinksKey,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.InProgress,
              statusMessage: `Determined that account ID ${ssoParams.TargetId} is not payerAccount`,
            },
            functionLogMode
          );
          const resolvedInstances: ListInstancesCommandOutput =
            await ssoAdminClientObject.send(new ListInstancesCommand({}));
          const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
          logger(
            {
              handler: handlerName,
              logMode: logModes.Debug,
              requestId: requestId,
              relatedData: provisionedLinksKey,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.InProgress,
              statusMessage: `Resolve SSO instanceArn: ${instanceArn}`,
            },
            functionLogMode
          );

          if (message.actionType === "create") {
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestId,
                relatedData: provisionedLinksKey,
                sourceRequestId: message.sourceRequestId,
                status: requestStatus.InProgress,
                statusMessage: `Processing create account assignment operation`,
              },
              functionLogMode
            );

            const provisionedLinks: GetCommandOutput =
              await ddbDocClientObject.send(
                new GetCommand({
                  TableName: provisionedLinksTable,
                  Key: {
                    parentLink: provisionedLinksKey,
                  },
                })
              );
            if (provisionedLinks.Item) {
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestId,
                  relatedData: provisionedLinksKey,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.Completed,
                  statusMessage: `Provisioned link already exists, not provisioning again`,
                },
                functionLogMode
              );
            } else {
              const ssoAssignmentOp: CreateAccountAssignmentCommandOutput =
                await ssoAdminClientObject.send(
                  new CreateAccountAssignmentCommand({
                    ...ssoParams,
                  })
                );
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Debug,
                  requestId: requestId,
                  relatedData: provisionedLinksKey,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `Triggered createAccountAssignment operation, requestID from service ${ssoAssignmentOp.AccountAssignmentCreationStatus?.RequestId}`,
                },
                functionLogMode
              );
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Debug,
                  requestId: requestId,
                  relatedData: provisionedLinksKey,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `Triggering pre-emptive delay`,
                },
                functionLogMode
              );

              /** Pre-emptively delay to avoid waitPenalty on waiter */
              await delay(15000);
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestId,
                  relatedData: provisionedLinksKey,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `Pre-emptive delay cycle complete, triggering createAccountAssignment waiter`,
                },
                functionLogMode
              );
              await waitUntilAccountAssignmentCreation(
                {
                  client: ssoAdminWaiterClientObject,
                  maxWaitTime: 600, //aggressive timeout to accommodate SSO Admin API's workflow based logic
                },
                {
                  InstanceArn: instanceArn,
                  AccountAssignmentCreationRequestId:
                    ssoAssignmentOp.AccountAssignmentCreationStatus?.RequestId,
                },
                requestId,
                functionLogMode + ""
              );
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestId,
                  relatedData: provisionedLinksKey,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `createAccountAssignment waiter returned`,
                },
                functionLogMode
              );
              await ddbClientObject.send(
                new PutCommand({
                  TableName: provisionedLinksTable,
                  Item: {
                    parentLink: provisionedLinksKey,
                    tagKeyLookUp: message.tagKeyLookUp,
                    principalType: ssoParams.PrincipalType,
                  },
                })
              );
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestId,
                  relatedData: provisionedLinksKey,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.Completed,
                  statusMessage: `createAccountAssignment operation completed`,
                },
                functionLogMode
              );
            }
          } else if (message.actionType === "delete") {
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestId,
                relatedData: provisionedLinksKey,
                sourceRequestId: message.sourceRequestId,
                status: requestStatus.InProgress,
                statusMessage: `Processing delete account assignment operation`,
              },
              functionLogMode
            );

            const provisionedLinks: GetCommandOutput =
              await ddbDocClientObject.send(
                new GetCommand({
                  TableName: provisionedLinksTable,
                  Key: {
                    parentLink: provisionedLinksKey,
                  },
                })
              );
            if (provisionedLinks.Item) {
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestId,
                  relatedData: provisionedLinksKey,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `Link currently provisioned, triggering delete account assignment operation`,
                },
                functionLogMode
              );

              const ssoAssignmentOp: DeleteAccountAssignmentCommandOutput =
                await ssoAdminClientObject.send(
                  new DeleteAccountAssignmentCommand({
                    ...ssoParams,
                  })
                );
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Debug,
                  requestId: requestId,
                  relatedData: provisionedLinksKey,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `Triggered deleteAccountAssignment operation, requestID from service ${ssoAssignmentOp.AccountAssignmentDeletionStatus?.RequestId}`,
                },
                functionLogMode
              );
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Debug,
                  requestId: requestId,
                  relatedData: provisionedLinksKey,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `Triggering pre-emptive delay`,
                },
                functionLogMode
              );
              /** Pre-emptively delay to avoid waitPenalty on waiter */
              await delay(15000);
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestId,
                  relatedData: provisionedLinksKey,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `Pre-emptive delay cycle complete, triggering deleteAccountAssignment waiter`,
                },
                functionLogMode
              );
              await waitUntilAccountAssignmentDeletion(
                {
                  client: ssoAdminWaiterClientObject,
                  maxWaitTime: 600, //aggressive timeout to accommodate SSO Admin API's workflow based logic
                },
                {
                  InstanceArn: instanceArn,
                  AccountAssignmentDeletionRequestId:
                    ssoAssignmentOp.AccountAssignmentDeletionStatus?.RequestId,
                },
                requestId,
                functionLogMode + ""
              );
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestId,
                  relatedData: provisionedLinksKey,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.InProgress,
                  statusMessage: `deleteAccountAssignment waiter returned`,
                },
                functionLogMode
              );
              await ddbClientObject.send(
                new DeleteCommand({
                  TableName: provisionedLinksTable,
                  Key: {
                    parentLink: provisionedLinksKey,
                  },
                })
              );
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestId,
                  relatedData: provisionedLinksKey,
                  sourceRequestId: message.sourceRequestId,
                  status: requestStatus.Completed,
                  statusMessage: `deleteAccountAssignment operation completed`,
                },
                functionLogMode
              );
            } else {
              logger({
                handler: "linkManagerHandler",
                logMode: logModes.Info,
                relatedData: `${provisionedLinksKey}`,
                requestId: requestId,
                sourceRequestId: message.sourceRequestId,
                status: requestStatus.Completed,
                statusMessage: `Link Manager delete operation ,provisioned link does not exit,so not triggering de-provisioning operation`,
              });
            }
          }
        } else {
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              relatedData: provisionedLinksKey,
              sourceRequestId: message.sourceRequestId,
              status: requestStatus.Completed,
              statusMessage: `Provisioned link does not exist, not triggering a delete`,
            },
            functionLogMode
          );
        }
      } catch (err) {
        if (
          err instanceof DynamoDBServiceException ||
          err instanceof SNSServiceException ||
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
                linksKeyValue
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
              linksKeyValue
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
                linksKeyValue
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
              linksKeyValue
            ),
          });
        }
      }
    })
  );
};

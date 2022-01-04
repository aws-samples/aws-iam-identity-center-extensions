/*
Objective: Implement link provisioning/deprovisioning operations
Trigger source: Link Manager SNS topic
- assumes role in SSO account for calling SSO admin API
- if the targetAccount is payerAccount, the operation is ignored as SSO Admin API does not allow this
- determine if the link action type is create or delete
- if create
  - do a lookup into provisioned links table with the
    link partition key
  - if link already exists, stop the process
  - if link does not exist yet, call sso create
    account assignment operation
  - wait until operation is complete/fail/time out
  - if operation is complete , update provisioned links table
- if delete
  - do a lookup into provisioned links table with the
    link partition key
  - if link does not exist, stop the process
  - if link exists, call sso delete account
    assignment operation
  - wait until operation is complete/fail/time out
  - if operation is complete, delete item from provisioined links table
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

// Environment configuration read
const {
  SSOAPIRoleArn,
  waiterHandlerSSOAPIRoleArn,
  ssoRegion,
  provisionedLinksTable,
  errorNotificationsTopicArn,
  payerAccount,
  AWS_REGION,
} = process.env;

// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import {
  CreateAccountAssignmentCommand,
  CreateAccountAssignmentCommandOutput,
  DeleteAccountAssignmentCommand,
  DeleteAccountAssignmentCommandOutput,
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
} from "@aws-sdk/lib-dynamodb";
import { SQSEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { waitUntilAccountAssignmentCreation } from "../../custom-waiters/src/waitUntilAccountAssignmentCreation";
import { waitUntilAccountAssignmentDeletion } from "../../custom-waiters/src/waitUntilAccountAssignmentDeletion";
import { ErrorMessage, requestStatus } from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";
// SDK and third party client object initialistaion
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
  maxAttempts: 2,
});
const ssoAdminWaiterClientObject = new SSOAdminClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: waiterHandlerSSOAPIRoleArn,
    },
  }),
  maxAttempts: 2,
});

//Error notification
const errorMessage: ErrorMessage = {
  Subject: "Error Processing link provisioning operation",
};

export const handler = async (event: SQSEvent) => {
  await Promise.all(
    event.Records.map(async (record) => {
      const requestId = uuidv4().toString();
      try {
        const message = JSON.parse(record.body);
        const { ssoParams } = message;
        const provisionedLinksKey = `${ssoParams.PrincipalId}@${
          ssoParams.TargetId
        }@${ssoParams.PermissionSetArn.split("/")[1]}@${
          ssoParams.PermissionSetArn.split("/")[2]
        }`;
        logger({
          handler: "linkManagerHandler",
          logMode: "info",
          relatedData: `${provisionedLinksKey}`,
          requestId: requestId,
          sourceRequestId: message.sourceRequestId,
          status: requestStatus.InProgress,
          statusMessage: `Link Manager operation in progress`,
        });
        if (ssoParams.TargetId !== payerAccount) {
          const resolvedInstances: ListInstancesCommandOutput =
            await ssoAdminClientObject.send(new ListInstancesCommand({}));
          const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
          if (message.actionType === "create") {
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
              // Link already exists, not creating again
              logger({
                handler: "linkManagerHandler",
                logMode: "info",
                relatedData: `${provisionedLinksKey}`,
                requestId: requestId,
                sourceRequestId: message.sourceRequestId,
                status: requestStatus.Completed,
                statusMessage: `Link Manager create operation , provisioned link already exists, therefore not provisioning again`,
              });
            } else {
              const ssoAssignmentOp: CreateAccountAssignmentCommandOutput =
                await ssoAdminClientObject.send(
                  new CreateAccountAssignmentCommand({
                    ...ssoParams,
                  })
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
                requestId
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
              logger({
                handler: "linkManagerHandler",
                logMode: "info",
                relatedData: `${provisionedLinksKey}`,
                requestId: requestId,
                sourceRequestId: message.sourceRequestId,
                status: requestStatus.Completed,
                statusMessage: `Link Manager create operation completed successfully`,
              });
            }
          } else if (message.actionType === "delete") {
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
              const ssoAssignmentOp: DeleteAccountAssignmentCommandOutput =
                await ssoAdminClientObject.send(
                  new DeleteAccountAssignmentCommand({
                    ...ssoParams,
                  })
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
                requestId
              );
              await ddbClientObject.send(
                new DeleteCommand({
                  TableName: provisionedLinksTable,
                  Key: {
                    parentLink: provisionedLinksKey,
                  },
                })
              );
              logger({
                handler: "linkManagerHandler",
                logMode: "info",
                relatedData: `${provisionedLinksKey}`,
                requestId: requestId,
                sourceRequestId: message.sourceRequestId,
                status: requestStatus.Completed,
                statusMessage: `Link Manager delete operation completed successfully`,
              });
            } else {
              // Link does not exist, so not triggering a delete again
              logger({
                handler: "linkManagerHandler",
                logMode: "info",
                relatedData: `${provisionedLinksKey}`,
                requestId: requestId,
                sourceRequestId: message.sourceRequestId,
                status: requestStatus.Completed,
                statusMessage: `Link Manager delete operation ,provisioned link does not exit,so not triggering de-provisioning operation`,
              });
            }
          }
        } else {
          // Ignoring link provisioning/deprovisioning operation for payer account
          logger({
            handler: "linkManagerHandler",
            logMode: "info",
            relatedData: `${provisionedLinksKey}`,
            requestId: requestId,
            sourceRequestId: message.sourceRequestId,
            status: requestStatus.Aborted,
            statusMessage: `Link Manager operation aborted as target account is payer account: ${ssoParams.TargetId}`,
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
          handler: "linkManagerHandler",
          logMode: "error",
          requestId: requestId,
          status: requestStatus.FailedWithException,
          statusMessage: `Link Manager operation failed with exception: ${JSON.stringify(
            err
          )} for eventDetail: ${JSON.stringify(record)}`,
        });
      }
    })
  );
};

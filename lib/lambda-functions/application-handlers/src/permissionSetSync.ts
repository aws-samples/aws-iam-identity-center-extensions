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
  functionLogMode,
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;

import {
  DynamoDBClient,
  DynamoDBServiceException,
} from "@aws-sdk/client-dynamodb";
import {
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

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
const messageSubject = "Exception in permission set sync processing";
let permissionSetName = "";

export const handler = async (event: SNSEvent) => {
  const requestId = uuidv4().toString();
  logger(
    {
      handler: handlerName,
      logMode: logModes.Info,
      requestId: requestId,
      status: requestStatus.InProgress,
      statusMessage: `Initiating permission set sync check logic`,
    },
    functionLogMode,
  );
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    permissionSetName = message.permission_set_name;
    const relatedLinks: QueryCommandOutput = await ddbDocClientObject.send(
      new QueryCommand({
        TableName: linksTableName,
        IndexName: "permissionSetName",
        KeyConditionExpression: "#permissionSetName = :permissionSetName",
        ExpressionAttributeNames: { "#permissionSetName": "permissionSetName" },
        ExpressionAttributeValues: {
          ":permissionSetName": message.permission_set_name,
        },
      }),
    );
    logger(
      {
        handler: handlerName,
        logMode: logModes.Debug,
        requestId: requestId,
        relatedData: permissionSetName,
        status: requestStatus.InProgress,
        statusMessage: `Validating if there are related account assignment links for this permission set`,
      },
      functionLogMode,
    );

    if (relatedLinks.Items && relatedLinks.Items.length !== 0) {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          relatedData: permissionSetName,
          status: requestStatus.InProgress,
          statusMessage: `Resolved that there are ${relatedLinks.Items.length} no of account assignments for this permission set`,
        },
        functionLogMode,
      );
      const resolvedInstances: ListInstancesCommandOutput =
        await ssoAdminClientObject.send(new ListInstancesCommand({}));
      const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
      const identityStoreId =
        resolvedInstances.Instances?.[0].IdentityStoreId + "";
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          relatedData: permissionSetName,
          status: requestStatus.InProgress,
          statusMessage: `Resolved instanceArn as ${instanceArn} and identityStoreId as ${identityStoreId}`,
        },
        functionLogMode,
      );

      await Promise.all(
        relatedLinks.Items.map(async (Item) => {
          let principalNameToLookUp = Item.principalName;
          if (adUsed === "true" && domainName !== "") {
            principalNameToLookUp = `${Item.principalName}@${domainName}`;
          }
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              relatedData: permissionSetName,
              status: requestStatus.InProgress,
              statusMessage: `Compputed principalName as ${principalNameToLookUp} for looking up in identity store`,
            },
            functionLogMode,
          );
          const principalId = await resolvePrincipal(
            identityStoreId,
            identityStoreClientObject,
            Item.principalType,
            principalNameToLookUp,
          );
          const staticSSOPayload: StaticSSOPayload = {
            InstanceArn: instanceArn,
            TargetType: "AWS_ACCOUNT",
            PrincipalType: Item.principalType,
          };
          if (principalId !== "0") {
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestId,
                relatedData: permissionSetName,
                status: requestStatus.InProgress,
                statusMessage: `Resolved principalId as ${principalId} for principalName ${principalNameToLookUp}`,
              },
              functionLogMode,
            );
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
                }),
              );
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestId,
                  relatedData: permissionSetName,
                  status: requestStatus.Completed,
                  statusMessage: `Triggered permission set based account assignment create for accountId ${Item.awsEntityData} tagged to principalID ${principalId}`,
                },
                functionLogMode,
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
                sfnClientObject,
              );
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestId,
                  relatedData: permissionSetName,
                  status: requestStatus.Completed,
                  statusMessage: `Triggered state machine for non-account assignment create for entityType  ${Item.awsEntityType} with entityData ${Item.awsEntityData}`,
                },
                functionLogMode,
              );
            }
          } else {
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestId,
                relatedData: permissionSetName,
                status: requestStatus.Completed,
                statusMessage: `No related principals found, completing permission set sync operation`,
              },
              functionLogMode,
            );
          }
        }),
      );
    } else {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          relatedData: permissionSetName,
          status: requestStatus.Completed,
          statusMessage: `No related account assignments found, completing permission set sync operation`,
        },
        functionLogMode,
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
            permissionSetName,
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
          permissionSetName,
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
            permissionSetName,
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
          permissionSetName,
        ),
      });
    }
  }
};

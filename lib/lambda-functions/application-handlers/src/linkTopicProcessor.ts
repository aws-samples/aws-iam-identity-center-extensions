/**
 * Objective: Implement link changes for link processing functionality Trigger
 * source: links topic notifications
 *
 * - Assumes role in SSO account for calling SSO admin API - listInstances
 * - For each record in the stream,
 *
 *   - Look up in permissionSetArn ddb table if the permission set referenced in the
 *       record exists
 *
 *       - If the permission set arn exists, then
 *
 *                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               - Look up in AWS IAM Identity Center Identity store if the user/group exists
 *
 *                   - If the user/group exists
 *
 *                                                   - Determine if the operation is create/delete
 *                                                   - Determine if link type is account /ou_id/root/account_tag
 *                                                   - If link type is account , post the link provisioning/deprovisioning operation to the link manager queue
 *                                                   - If link type is ou_id, root,account_tag invoke org entities state machine
 *                   - If the user/group does not exist
 *
 *                                                   - Stop processing as we won't be able to proceed without the principal Arn
 *       - If the permission set does not exist, do nothing as we cannot do link
 *               provisioning if the permission set is not yet provisioned
 * - Catch all failures in a generic exception block and post the error details to
 *   error notifications topics
 */

const {
  SSOAPIRoleArn,
  ISAPIRoleArn,
  orgListSMRoleArn,
  processTargetAccountSMArn,
  processTargetAccountSMTopicArn,
  permissionSetArnTable,
  linkQueueUrl,
  adUsed,
  domainName,
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
  GetCommand,
  GetCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { SNSEvent } from "aws-lambda";
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
const sfnClientObject = new SFNClient({
  region: "us-east-1",
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: orgListSMRoleArn,
    },
  }),
  maxAttempts: 2,
});
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

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
const messageSubject = "Exception in account assignment topic processor";
let requestIdValue = "";
let linkDataValue = "";

export const handler = async (event: SNSEvent) => {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const { action, linkData, requestId } = message;
    requestIdValue = requestId;
    linkDataValue = linkData;
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestId,
        status: requestStatus.InProgress,
        relatedData: linkData,
        statusMessage: `Started account assignment topic processor for action ${action}`,
      },
      functionLogMode
    );
    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn;
    logger(
      {
        handler: handlerName,
        logMode: logModes.Debug,
        requestId: requestId,
        status: requestStatus.InProgress,
        relatedData: linkData,
        statusMessage: `Resolved SSO instance arn ${instanceArn}`,
      },
      functionLogMode
    );

    const identityStoreId =
      resolvedInstances.Instances?.[0].IdentityStoreId + "";

    logger(
      {
        handler: handlerName,
        logMode: logModes.Debug,
        requestId: requestId,
        status: requestStatus.InProgress,
        relatedData: linkData,
        statusMessage: `Resolved identityStoreID ${identityStoreId}`,
      },
      functionLogMode
    );
    const delimeter = "%";
    const linkKeyArray = linkData.split(delimeter);
    const entityType = linkKeyArray?.[0];
    const entityValue = linkKeyArray?.[1];
    const permissionsetName = linkKeyArray?.[2];

    const principalName = linkKeyArray?.[3];
    const principalType = linkKeyArray?.[4];

    const staticSSOPayload: StaticSSOPayload = {
      InstanceArn: instanceArn + "",
      TargetType: "AWS_ACCOUNT",
      PrincipalType: principalType,
    };

    const permissionSetRecord: GetCommandOutput = await ddbDocClientObject.send(
      new GetCommand({
        TableName: permissionSetArnTable,
        Key: {
          permissionSetName: permissionsetName,
        },
      })
    );

    if (permissionSetRecord.Item) {
      const { permissionSetArn } = permissionSetRecord.Item;
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          status: requestStatus.InProgress,
          relatedData: linkData,
          statusMessage: `Determined permission set exists for this account assignment with arn value ${permissionSetArn}`,
        },
        functionLogMode
      );

      let principalNameToLookUp = principalName;
      if (adUsed === "true" && domainName !== "") {
        principalNameToLookUp = `${principalName}@${domainName}`;
      }
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          status: requestStatus.InProgress,
          relatedData: linkData,
          statusMessage: `Lookup principal name computed ${principalNameToLookUp}`,
        },
        functionLogMode
      );
      const principalId = await resolvePrincipal(
        identityStoreId,
        identityStoreClientObject,
        principalType,
        principalNameToLookUp
      );

      if (principalId !== "0") {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            relatedData: linkData,
            statusMessage: `Resolved principal ID ${principalId} for principalName ${principalNameToLookUp} from identity store`,
          },
          functionLogMode
        );
        if (entityType === "account") {
          logger(
            {
              handler: handlerName,
              logMode: logModes.Debug,
              requestId: requestId,
              status: requestStatus.InProgress,
              relatedData: linkData,
              statusMessage: `Determined entitytype is account`,
            },
            functionLogMode
          );
          await sqsClientObject.send(
            new SendMessageCommand({
              QueueUrl: linkQueueUrl,
              MessageBody: JSON.stringify({
                ssoParams: {
                  ...staticSSOPayload,
                  TargetId: entityValue,
                  PermissionSetArn: permissionSetArn,
                  PrincipalId: principalId,
                },
                actionType: action,
                entityType: entityType,
                tagKeyLookUp: "none",
                sourceRequestId: requestId,
              }),
              MessageGroupId: entityValue.slice(-1),
            })
          );
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              status: requestStatus.Completed,
              relatedData: linkData,
              statusMessage: `Account assignment ${action} operation is posted to account assignment queue`,
            },
            functionLogMode
          );
        } else if (
          entityType === "ou_id" ||
          entityType === "root" ||
          entityType === "account_tag"
        ) {
          const stateMachinePayload: StateMachinePayload = {
            action: action,
            entityType: entityType,
            instanceArn: staticSSOPayload.InstanceArn,
            permissionSetArn: permissionSetArn,
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
            entityValue + "",
            processTargetAccountSMArn + "",
            sfnClientObject
          );
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              status: requestStatus.Completed,
              relatedData: linkData,
              statusMessage: `Account assignment ${action} operation payload triggered process target account state machine for entityType ${entityType}`,
            },
            functionLogMode
          );
        }
      } else {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.Aborted,
            relatedData: linkData,
            statusMessage: `Account assignment ${action} operation aborted as the principal ${principalNameToLookUp} referenced is not found in identity store`,
          },
          functionLogMode
        );
      }
    } else {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          status: requestStatus.Aborted,
          relatedData: linkData,
          statusMessage: `Account assignment ${action} operation aborted as the permission set ${permissionsetName} referenced is not yet provisioned`,
        },
        functionLogMode
      );
    }
  } catch (err) {
    if (
      err instanceof DynamoDBServiceException ||
      err instanceof IdentitystoreServiceException ||
      err instanceof SFNServiceException ||
      err instanceof SQSServiceException ||
      err instanceof SSOAdminServiceException ||
      err instanceof SNSServiceException
    ) {
      await snsClientObject.send(
        new PublishCommand({
          TopicArn: errorNotificationsTopicArn,
          Subject: messageSubject,
          Message: constructExceptionMessage(
            requestIdValue,
            handlerName,
            err.name,
            err.message,
            linkDataValue
          ),
        })
      );
      logger({
        handler: handlerName,
        requestId: requestIdValue,
        logMode: logModes.Exception,
        status: requestStatus.FailedWithException,
        statusMessage: constructExceptionMessageforLogger(
          requestIdValue,
          err.name,
          err.message,
          linkDataValue
        ),
      });
    } else {
      await snsClientObject.send(
        new PublishCommand({
          TopicArn: errorNotificationsTopicArn,
          Subject: messageSubject,
          Message: constructExceptionMessage(
            requestIdValue,
            handlerName,
            "Unhandled exception",
            JSON.stringify(err),
            linkDataValue
          ),
        })
      );
      logger({
        handler: handlerName,
        requestId: requestIdValue,
        logMode: logModes.Exception,
        status: requestStatus.FailedWithException,
        statusMessage: constructExceptionMessageforLogger(
          requestIdValue,
          "Unhandled exception",
          JSON.stringify(err),
          linkDataValue
        ),
      });
    }
  }
};

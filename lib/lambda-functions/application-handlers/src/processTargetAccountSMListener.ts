/**
 * Objective: Listener for step function outputs from org account Trigger
 * source: Process Target Account SM topic
 *
 * - Determines if entity_tye is account_tag and if it is, extracts the account id
 * - Prepares the payload required
 * - Posts the payload to link manager topic
 * - Catch all failures in a generic exception block and post the error details to
 *   error notifications topics
 */

const {
  errorNotificationsTopicArn,
  linkQueueUrl,
  AWS_REGION,
  functionLogMode,
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;

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
import { SNSEvent } from "aws-lambda";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import {
  constructExceptionMessage,
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";

const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });
const sqsClientObject = new SQSClient({ region: AWS_REGION, maxAttempts: 2 });

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
const messageSubject =
  "Exception in processing state machine invocations for non-account scope type assignments";
let requestIdValue = "";
let targetIdValue = "";
export const handler = async (event: SNSEvent) => {
  const message = JSON.parse(event.Records[0].Sns.Message);
  requestIdValue = message.sourceRequestId;
  try {
    let targetId = "";
    let tagKeyValue = "none";
    if (message.entityType === "account_tag") {
      targetId = message.pretargetId.split("/")[2];
      tagKeyValue = `${message.tagKey}^${targetId}`;
    } else {
      targetId = message.pretargetId;
    }
    targetIdValue = `${message.action}-${targetId}-${message.principalType}-${message.principalId}`;
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestIdValue,
        relatedData: targetIdValue,
        status: requestStatus.InProgress,
        statusMessage: `Processing SQS payload post for account assignment operation - ${message.action}`,
      },
      functionLogMode,
    );

    await sqsClientObject.send(
      new SendMessageCommand({
        QueueUrl: linkQueueUrl,
        MessageBody: JSON.stringify({
          ssoParams: {
            InstanceArn: message.instanceArn,
            TargetType: message.targetType,
            PrincipalType: message.principalType,
            PrincipalId: message.principalId,
            PermissionSetArn: message.permissionSetArn,
            TargetId: targetId,
          },
          actionType: message.action,
          entityType: message.entityType,
          tagKeyLookUp: tagKeyValue,
          sourceRequestId: message.sourceRequestId,
        }),
        MessageGroupId: targetId.slice(-1),
      }),
    );
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestIdValue,
        relatedData: targetIdValue,
        status: requestStatus.InProgress,
        statusMessage: `Posted account assignment operation - ${message.action} for targetId ${targetId} and permissionSetArn ${message.permissionSetArn} and principalId ${message.principalId} and principalType ${message.principalType}`,
      },
      functionLogMode,
    );
  } catch (err) {
    if (
      err instanceof SNSServiceException ||
      err instanceof SQSServiceException
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
            targetIdValue,
          ),
        }),
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
          targetIdValue,
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
            targetIdValue,
          ),
        }),
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
          targetIdValue,
        ),
      });
    }
  }
};

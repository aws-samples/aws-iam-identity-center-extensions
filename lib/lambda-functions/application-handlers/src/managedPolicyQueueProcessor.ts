/**
 * Objective:
 *
 * Processes managed policy queue items, by reading and posting the payload to
 * state machines for managed policy(AWS and customer) operations
 */

const {
  SSOMPRoleArn,
  errorNotificationsTopicArn,
  ssoRegion,
  AWS_REGION,
  functionLogMode,
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;

import {
  SFNClient,
  SFNServiceException,
  StartExecutionCommand,
} from "@aws-sdk/client-sfn";
import {
  PublishCommand,
  SNSClient,
  SNSServiceException,
} from "@aws-sdk/client-sns";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";

import { SQSEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  logModes,
  ManagedPolicyQueueObject,
  requestStatus,
} from "../../helpers/src/interfaces";
import {
  constructExceptionMessage,
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";

const sfnClientObject = new SFNClient({
  region: ssoRegion,
  maxAttempts: 2,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: SSOMPRoleArn,
    },
  }),
});

const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
const messageSubject = "Exception in managed policy queue processor";
const mpName = "";

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
          statusMessage: `Started processing managed policy queue operation`,
        },
        functionLogMode
      );
      try {
        const message: ManagedPolicyQueueObject = JSON.parse(record.body);
        if (message.managedPolicytype === "aws") {
          /** AWS managed policy operation */
          await sfnClientObject.send(
            new StartExecutionCommand({
              stateMachineArn: message.stateMachineArn,
              input: JSON.stringify(message.managedPolicyObject),
            })
          );
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              status: requestStatus.Completed,
              statusMessage: `Completed posting managed policy queue operation`,
            },
            functionLogMode
          );
        } else if (message.managedPolicytype === "customer") {
          /** Customer managed policy operation */
          await sfnClientObject.send(
            new StartExecutionCommand({
              stateMachineArn: message.stateMachineArn,
              input: JSON.stringify(message.managedPolicyObject),
            })
          );
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              status: requestStatus.Completed,
              statusMessage: `Completed posting managed policy queue operation`,
            },
            functionLogMode
          );
        } else {
          logger(
            {
              handler: handlerName,
              logMode: logModes.Exception,
              requestId: requestId,
              status: requestStatus.FailedWithException,
              statusMessage: `Managed Policy type ${message.managedPolicytype} is incorrect`,
            },
            functionLogMode
          );
        }
      } catch (err) {
        if (
          err instanceof SFNServiceException ||
          err instanceof SNSServiceException
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
                mpName
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
              mpName
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
                mpName
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
              mpName
            ),
          });
        }
      }
    })
  );
};

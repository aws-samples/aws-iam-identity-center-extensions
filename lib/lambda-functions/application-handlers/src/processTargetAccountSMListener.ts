/*
Objective: Listener for step function outputs from org account
Trigger source: Process Target Account SM topic
- determines if entity_tye is account_tag and if it is, extracts the account id
- prepares the payload required
- posts the payload to link manager topic
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

const { errorNotificationsTopicArn, linkQueueUrl, AWS_REGION } = process.env;

// SDK and third party client imports
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
import { SNSEvent } from "aws-lambda";
import { ErrorMessage, requestStatus } from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";
// SDK and third party client object initialistaion
const snsClientObject = new SNSClient({ region: AWS_REGION });
const sqsClientObject = new SQSClient({ region: AWS_REGION });

//Error notification
const errorMessage: ErrorMessage = {
  Subject: "Error Processing target account listener handler",
};

export const handler = async (event: SNSEvent) => {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    let targetId = "";
    let tagKeyValue = "none";

    if (message.entityType === "account_tag") {
      targetId = message.pretargetId.split("/")[2];
      tagKeyValue = `${message.tagKey}^${targetId}`;
    } else {
      targetId = message.pretargetId;
    }
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
        MessageDeduplicationId: `${message.action}-${targetId}-${
          message.permissionSetArn.toString().split("/")[2]
        }-${message.principalId}`,
        MessageGroupId: `${targetId}-${
          message.permissionSetArn.toString().split("/")[2]
        }-${message.principalId}`,
      })
    );
    logger({
      handler: "processTargetAccountSMListener",
      logMode: "info",
      relatedData: `${targetId}`,
      requestId: message.sourceRequestId,
      status: requestStatus.InProgress,
      statusMessage: `Target account listener posted the link provisioning/de-provisioning operation to link manager topic`,
    });
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
      handler: "processTargetAccountSMListener",
      logMode: "error",
      status: requestStatus.FailedWithException,
      statusMessage: `Target account listener failed with exception: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`,
    });
  }
};

/*
Objective: Listener for step function outputs from org account
Trigger source: Process Target Account SM topic
- determines if entity_tye is account_tag and if it is, extracts the account id
- prepares the payload required
- posts the payload to link manager topic
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

const { errorNotificationsTopicArn, linkManagertopicArn, AWS_REGION } =
  process.env;

// SDK and third party client imports
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { SNSEvent } from "aws-lambda";
import { ErrorMessage } from "../../helpers/src/interfaces";

// SDK and third party client object initialistaion
const snsClientObject = new SNSClient({ region: AWS_REGION });

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

    await snsClientObject.send(
      new PublishCommand({
        TopicArn: linkManagertopicArn,
        Message: JSON.stringify({
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
        }),
      })
    );
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
    console.error(
      `Exception when processing target account listener: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`
    );
  }
};

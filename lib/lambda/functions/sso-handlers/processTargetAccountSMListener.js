/*
Objective: Listener for step function outputs from org account
Trigger source: Process Target Account SM topic
- determines if entity_tye is account_tag and if it is, extracts the account id
- prepares the payload required
- posts the payload to link manager topic
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

const { errorNotificationsTopicArn, linkManagertopicArn, AWS_REGION } = process.env;

// SDK and third party client imports
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

// SDK and third party client object initialistaion
const snsClientObject = new SNSClient({ region: AWS_REGION });

const errorParams = {
  TopicArn: errorNotificationsTopicArn,
};
const errorMessage = {};
errorMessage.Subject = 'Error Processing target account listener handler';

exports.handler = async (event) => {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const params = {
      TopicArn: linkManagertopicArn,
    };

    let targetId = '';
    let tagkeyvalue = 'none';

    if (message.entityType === 'account_tag') {
      // eslint-disable-next-line prefer-destructuring
      targetId = message.pretargetId.split('/')[2];
      tagkeyvalue = `${message.tagKey}^${targetId}`;
    } else {
      targetId = message.pretargetId;
    }

    const ssoParams = {
      InstanceArn: message.instanceArn,
      TargetType: message.targetType,
      PrincipalType: message.principalType,
      PrincipalId: message.principalId,
      PermissionSetArn: message.permissionSetArn,
      TargetId: targetId,
    };

    const messageParams = {
      ssoParams,
      actionType: message.action,
      entityType: message.entityType,
      tagKeyLookUp: tagkeyvalue,
    };

    params.Message = JSON.stringify(messageParams);
    await snsClientObject.send(new PublishCommand(params));
    console.log(
      `In SMListner, published payload to link manager topic: ${JSON.stringify(
        messageParams,
      )}`,
    );
  } catch (err) {
    console.error(
      'Main handler exception in processTargetAccountSMListener: ',
      err,
    );
    errorMessage.event_detail = event;
    errorMessage.error_details = err;
    errorParams.Message = JSON.stringify(errorMessage);
    await snsClientObject.send(new PublishCommand(errorParams));
  }
};

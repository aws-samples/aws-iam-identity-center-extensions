/*
Objective: Implement link provisioning/deprovisioning operations
Trigger source: Link Manager SNS topic
- assumes role in SSO account for calling SSO admin API
- determine if the link action type is create or delete
- if create
  - do a lookup into provisioned links table with the
    link partition key
  - if link already exists, stop the process
  - if link does not exist yet, call sso create
    account assignment operation, and post the
    request id to waiter handler topic
- if delete
  - do a lookup into provisioned links table with the
    link partition key
  - if link does not exist, stop the process
  - if link exists, call sso delete account
    assignment operation, and post the request id to
    waiter handler topic
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

const {
  SSOAPIRoleArn,
  ssoRegion,
  provisionedLinksTable,
  waiterTopicArn,
  errorNotificationsTopicArn,
  payerAccount,
  AWS_REGION,
} = process.env;

// SDK and third party client imports
const { fromTemporaryCredentials } = require('@aws-sdk/credential-providers');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const {
  SSOAdminClient,
  CreateAccountAssignmentCommand,
  DeleteAccountAssignmentCommand,
} = require('@aws-sdk/client-sso-admin');

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION });
const ssoAdminClientObject = new SSOAdminClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: SSOAPIRoleArn,
    },
  }),
});

const errorParams = {
  TopicArn: errorNotificationsTopicArn,
};
const errorMessage = {};
errorMessage.Subject = 'Error Processing Link provisioning operation';
const waiterParams = {
  TopicArn: waiterTopicArn,
};
const waiterMessage = {};

exports.handler = async (event) => {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const { ssoParams } = message;
    if (ssoParams.TargetId !== payerAccount) {
      waiterMessage.instance_arn = ssoParams.InstanceArn;
      const provisionedLinksKey = `${ssoParams.PrincipalId}@${
        ssoParams.TargetId
      }@${ssoParams.PermissionSetArn.split('/')[1]}@${
        ssoParams.PermissionSetArn.split('/')[2]
      }`;

      if (message.actionType === 'create') {
        const provisionedLinks = await ddbDocClientObject.send(
          new GetCommand({
            TableName: provisionedLinksTable,
            Key: {
              parentLink: provisionedLinksKey,
            },
          }),
        );
        if (provisionedLinks.Item) {
          // Link already exists, not creating again
          console.log(
            `in linkManager, provisioned link: ${provisionedLinksKey} already exists, therefore not provisioning again`,
          );
        } else {
          const ssoAssignmentOp = await ssoAdminClientObject.send(
            new CreateAccountAssignmentCommand({
              ...ssoParams,
            }),
          );
          waiterMessage.waiter_name = 'AccountAssignmentCreated';
          waiterMessage.request_id = ssoAssignmentOp.AccountAssignmentCreationStatus.RequestId;
          waiterMessage.provisioned_links_key = provisionedLinksKey;
          waiterMessage.tag_key_lookup = message.tagKeyLookUp;
          waiterParams.Message = JSON.stringify(waiterMessage);
          await snsClientObject.send(new PublishCommand(waiterParams));
          console.log(
            `in linkManager, provisioned link: ${provisionedLinksKey} does not exist, triggered provisioning operation and posted to waiter topic`,
          );
        }
      } else if (message.actionType === 'delete') {
        const provisionedLinks = await ddbDocClientObject.send(
          new GetCommand({
            TableName: provisionedLinksTable,
            Key: {
              parentLink: provisionedLinksKey,
            },
          }),
        );
        if (provisionedLinks.Item) {
          const ssoAssignmentOp = await ssoAdminClientObject.send(
            new DeleteAccountAssignmentCommand({
              ...ssoParams,
            }),
          );
          waiterMessage.waiter_name = 'AccountAssignmentDeleted';
          waiterMessage.request_id = ssoAssignmentOp.AccountAssignmentDeletionStatus.RequestId;
          waiterMessage.provisioned_links_key = provisionedLinksKey;
          waiterMessage.tag_key_lookup = message.tagKeyLookUp;
          waiterParams.Message = JSON.stringify(waiterMessage);
          await snsClientObject.send(new PublishCommand(waiterParams));
          console.log(
            `in linkManager, provisioned link: ${provisionedLinksKey} exists, triggered de-provisioning operation and posted to waiter topic`,
          );
        } else {
          // Link does not exist, so not triggering a delete again
          console.log(
            `in linkManager, provisioned link: ${provisionedLinksKey} does not exit,so not triggering de-provisioning operation`,
          );
        }
      }
    } else {
      // Ignoring link provisioning/deprovisioning operation for payer account
      console.log(
        `Ignoring provisioning/deprovisioning as target account is payer account: ${ssoParams.TargetId}`,
      );
    }
  } catch (err) {
    console.error('main handler exception in linkManager: ', err);
    errorMessage.event_detail = event;
    errorMessage.error_details = err;
    errorParams.Message = JSON.stringify(errorMessage);
    await snsClientObject.send(new PublishCommand(errorParams));
  }
};

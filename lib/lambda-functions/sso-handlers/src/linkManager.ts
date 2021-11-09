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

// Environment configuration read
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
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import {
  SSOAdminClient,
  CreateAccountAssignmentCommand,
  DeleteAccountAssignmentCommand,
  CreateAccountAssignmentCommandOutput,
  DeleteAccountAssignmentCommandOutput,
} from "@aws-sdk/client-sso-admin";
import { ErrorMessage } from "../../helpers/src/interfaces";
import { SNSEvent } from "aws-lambda";

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

//Error notification
let errorMessage: ErrorMessage = {
  Subject: "Error Processing link provisioning operation",
};

export const handler = async (event: SNSEvent) => {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const { ssoParams } = message;
    if (ssoParams.TargetId !== payerAccount) {
      const provisionedLinksKey = `${ssoParams.PrincipalId}@${
        ssoParams.TargetId
      }@${ssoParams.PermissionSetArn.split("/")[1]}@${
        ssoParams.PermissionSetArn.split("/")[2]
      }`;
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
          console.log(
            `in linkManager, provisioned link: ${provisionedLinksKey} already exists, therefore not provisioning again`
          );
        } else {
          const ssoAssignmentOp: CreateAccountAssignmentCommandOutput =
            await ssoAdminClientObject.send(
              new CreateAccountAssignmentCommand({
                ...ssoParams,
              })
            );
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: waiterTopicArn,
              Message: JSON.stringify({
                instance_arn: ssoParams.InstanceArn,
                waiter_name: "AccountAssignmentCreated",
                request_id:
                  ssoAssignmentOp.AccountAssignmentCreationStatus?.RequestId,
                provisioned_links_key: provisionedLinksKey,
                tag_key_lookup: message.tagKeyLookUp,
              }),
            })
          );
          console.log(
            `in linkManager, provisioned link: ${provisionedLinksKey} does not exist, triggered provisioning operation and posted to waiter topic`
          );
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
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: waiterTopicArn,
              Message: JSON.stringify({
                instance_arn: ssoParams.InstanceArn,
                waiter_name: "AccountAssignmentDeleted",
                request_id:
                  ssoAssignmentOp.AccountAssignmentDeletionStatus?.RequestId,
                provisioned_links_key: provisionedLinksKey,
                tag_key_lookup: message.tagKeyLookUp,
              }),
            })
          );
          console.log(
            `in linkManager, provisioned link: ${provisionedLinksKey} exists, triggered de-provisioning operation and posted to waiter topic`
          );
        } else {
          // Link does not exist, so not triggering a delete again
          console.log(
            `in linkManager, provisioned link: ${provisionedLinksKey} does not exit,so not triggering de-provisioning operation`
          );
        }
      }
    } else {
      // Ignoring link provisioning/deprovisioning operation for payer account
      console.log(
        `Ignoring provisioning/deprovisioning as target account is payer account: ${ssoParams.TargetId}`
      );
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
    console.error(
      `Exception when processing link provisioning/de-provisioning: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`
    );
  }
};

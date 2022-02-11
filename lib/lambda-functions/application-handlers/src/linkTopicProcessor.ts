/*
Objective: Implement link changes for link processing functionality
Trigger source: links topic notifications
- assumes role in SSO account for calling SSO admin API - listInstances
- For each record in the stream,
    - look up in permissionSetArn ddb table if the permission set referenced in the record exists
      - if the permission set arn exists, then
        - look up in AWS SSO Identity store if the user/group exists
            - if the user/group exists
                - determine if the operation is create/delete
                - determine if link type is account /ou_id/root/account_tag
                - if link type is account ,
                    post the link provisioning/deprovisioning operation
                    to the link manager queue
                - if link type is ou_id, root,account_tag
                    invoke org entities state machine
            - if the user/group does not exist
                - stop processing as we won't be able to proceed
                  without the principal Arn
      - if the permission set does not exist,
        do nothing as we cannot do link
        provisioning if the permission set
        is not yet provisioned
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

// Environment configuration read
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
  AWS_REGION,
} = process.env;

// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { IdentitystoreClient } from "@aws-sdk/client-identitystore";
import { SFNClient } from "@aws-sdk/client-sfn";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import {
  ListInstancesCommand,
  ListInstancesCommandOutput,
  SSOAdminClient,
} from "@aws-sdk/client-sso-admin";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import {
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { SNSEvent } from "aws-lambda";
import {
  ErrorMessage,
  requestStatus,
  StateMachinePayload,
  StaticSSOPayload,
} from "../../helpers/src/interfaces";
import {
  invokeStepFunction,
  logger,
  resolvePrincipal,
} from "../../helpers/src/utilities";

// SDK and third party client object initialistaion
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

//Error notification
const errorMessage: ErrorMessage = {
  Subject: "Error Processing link topic processor",
};

export const handler = async (event: SNSEvent) => {
  try {
    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));

    // Instance Arn needed for SSO admin API's
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn;
    // Identity store ID needed for SSO Identity Store API's
    const identityStoreId =
      resolvedInstances.Instances?.[0].IdentityStoreId + "";

    // Because it's a stream handler, there
    // could be more than one link updates coming through, hence the proimse all
    const message = JSON.parse(event.Records[0].Sns.Message);
    const { action, linkData, requestId } = message;
    logger({
      handler: "linkTopicProcessor",
      logMode: "info",
      requestId: requestId,
      relatedData: `${linkData}`,
      status: requestStatus.InProgress,
      statusMessage: `Link topic processor ${action} operation in progress`,
    });
    // Deconstruct and get the values for the SSO Admin API operations
    const delimeter = "%";
    const linkKeyArray = linkData.split(delimeter);
    const entityType = linkKeyArray?.[0];
    const entityValue = linkKeyArray?.[1];
    const permissionsetName = linkKeyArray?.[2];
    //const principalName = linkKeyArray?.slice(3, -2).join(delimeter);
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
      // Compute user/group name based on whether Active Directory is the user store
      let principalNameToLookUp = principalName;
      if (adUsed === "true" && domainName !== "") {
        principalNameToLookUp = `${principalName}@${domainName}`;
      }
      const principalId = await resolvePrincipal(
        identityStoreId,
        identityStoreClientObject,
        principalType,
        principalNameToLookUp
      );

      if (principalId !== "0") {
        if (entityType === "account") {
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
              MessageDeduplicationId: `${action}-${entityValue}-${
                permissionSetArn.toString().split("/")[2]
              }-${principalId}`,
              MessageGroupId: `${entityValue}-${
                permissionSetArn.toString().split("/")[2]
              }-${principalId}`,
            })
          );
          logger({
            handler: "linkTopicProcessor",
            logMode: "info",
            relatedData: `${linkData}`,
            requestId: requestId,
            status: requestStatus.Completed,
            statusMessage: `Link topic processor ${action} operation completed by posting to link manager topic`,
          });
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
          };
          await invokeStepFunction(
            stateMachinePayload,
            entityValue + "",
            processTargetAccountSMArn + "",
            sfnClientObject
          );
          logger({
            handler: "linkTopicProcessor",
            logMode: "info",
            requestId: requestId,
            relatedData: `${linkData}`,
            status: requestStatus.Completed,
            statusMessage: `Link topic processor ${action} operation completed by posting to step functions state machine`,
          });
        }
      } else {
        // No related principals found for this link
        logger({
          handler: "linkTopicProcessor",
          logMode: "info",
          relatedData: `${linkData}`,
          requestId: requestId,
          status: requestStatus.Completed,
          statusMessage: `Link topic processor ${action} operation completed as no related principals found for this link`,
        });
      }
    } else {
      // Permission set does not exist
      logger({
        handler: "linkTopicProcessor",
        logMode: "info",
        relatedData: `${linkData}`,
        requestId: requestId,
        status: requestStatus.Aborted,
        statusMessage: `Link topic processor ${action} operation aborted as permissionSet does not yet exist`,
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
      handler: "linkTopicProcessor",
      logMode: "error",
      status: requestStatus.FailedWithException,
      statusMessage: `Link topic processor failed with exception: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`,
    });
  }
};

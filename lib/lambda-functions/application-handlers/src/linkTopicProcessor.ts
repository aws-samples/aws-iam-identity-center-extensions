/*
Objective: Implement link changes for link processing functionality
Trigger source: links topic notifications
- assumes role in SSO account for calling SSO admin API - listInstances
- For each record in the stream,
    - look up in permissionSetArn ddb table if the permission set referenced in the record exists
      - if the permission set arn exists, then
        - look up in the groups ddb table, if the group referenced in the record exists
            - if the group exists
                - determine if the operation is create/delete
                - determine if link type is account /ou_id/root
                - if link type is account ,
                    post the link provisioning/deprovisioning operation
                    to the link manager SNS topic
                - if link type is ou_id, root,account_tag
                    resolve this into actual accounts
                    and post the link provisioning/deprovisioning
                    operation for each account to the link manager SNS topic
            - if the group does not exist, verify if the SSO configuration is using Active Directory
                - if it uses AD configuration
                     - resolve the group ID
                       (as SSO generates this just-in-time)
                       by calling identity store API
                     - determine if link type is account /ou_id/root
                      - if link type is
                        account ,post the link provisioning/deprovisioning
                        operation to the link manager SNS topic
                      - if link type is
                        ou_id, root,account_tagresolve this into actual accounts
                        and post the link provisioning/deprovisioning operation
                        for each account
                        to the link manager SNS topic
                - if it does not use Active Directory configuration,
                  stop processing as we won't be able to proceed
                  without groupID which is the principal Arn
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
  processTargetAccountSMInvokeRoleArn,
  processTargetAccountSMArn,
  groupsTable,
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
import {
  IdentitystoreClient,
  ListGroupsCommand,
  ListGroupsCommandOutput,
} from "@aws-sdk/client-identitystore";
import { SFNClient } from "@aws-sdk/client-sfn";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";
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
  PutCommand,
  QueryCommand,
  QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { SNSEvent } from "aws-lambda";
import {
  ErrorMessage,
  requestStatus,
  StateMachinePayload,
  StaticSSOPayload,
} from "../../helpers/src/interfaces";
import { invokeStepFunction, logger } from "../../helpers/src/utilities";

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION });
const sqsClientObject = new SQSClient({ region: AWS_REGION });
const sfnClientObject = new SFNClient({
  region: "us-east-1",
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: processTargetAccountSMInvokeRoleArn,
    },
  }),
});
const ssoAdminClientObject = new SSOAdminClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: SSOAPIRoleArn,
    },
  }),
});
const identityStoreClientObject = new IdentitystoreClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: ISAPIRoleArn,
    },
  }),
});

//Error notification
const errorMessage: ErrorMessage = {
  Subject: "Error Processing link stream handler",
};

export const handler = async (event: SNSEvent) => {
  try {
    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));

    // Instance Arn needed for SSO admin API's
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn;
    // Identity store ID needed for SSO Identity Store API's
    const identityStoreId = resolvedInstances.Instances?.[0].IdentityStoreId;

    // Because it's a stream handler, there
    // could be more than one link updates coming through, hence the proimse all
    const staticSSOPayload: StaticSSOPayload = {
      InstanceArn: instanceArn + "",
      TargetType: "AWS_ACCOUNT",
      PrincipalType: "GROUP",
    };

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
    const delimeter = ".";
    const linkKeyArray = linkData.split(delimeter);
    const entityType = linkKeyArray?.[0];
    const entityValue = linkKeyArray?.[1];
    const permissionsetName = linkKeyArray?.[2];
    const groupName = linkKeyArray?.slice(3, -1).join(delimeter);
    // We only process the link provisioning/de-provisioing
    // if the
    // following conditions are met
    // the permission set referenced in the link is
    // already provisioined i.e. look up permissionSetArn
    // table (we need this for the
    //  SSO Admin API operations)
    // The group referenced also exists
    //    - if AD config is not being used, this is a direct lookup into the groups
    // table to resolve the group ID value(random id that SSO generates for groups)
    //    - if AD config is actually being used,
    // this is done by resolving the group ID dynamically
    // by calling Identity store listGroups()
    // Once the permission setArn and the group exists,
    // then we determine the entity type
    // if entity is account, one message posted to the topic
    // if entity is root, ou_id, resolve the exact
    // no of accounts and post the messsages to the topic

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
      const relatedGroups: QueryCommandOutput = await ddbDocClientObject.send(
        // QueryCommand is a pagniated call, however the logic requires
        // checking only if the result set is greater than 0
        new QueryCommand({
          TableName: groupsTable,
          IndexName: "groupName",
          KeyConditionExpression: "#groupname = :groupname",
          ExpressionAttributeNames: { "#groupname": "groupName" },
          ExpressionAttributeValues: { ":groupname": groupName },
        })
      );
      if (relatedGroups.Items?.length !== 0) {
        if (entityType === "account") {
          await sqsClientObject.send(
            new SendMessageCommand({
              QueueUrl: linkQueueUrl,
              MessageBody: JSON.stringify({
                ssoParams: {
                  ...staticSSOPayload,
                  TargetId: entityValue,
                  PermissionSetArn: permissionSetArn,
                  PrincipalId: relatedGroups.Items?.[0].groupId,
                },
                actionType: action,
                entityType: entityType,
                tagKeyLookUp: "none",
                sourceRequestId: requestId,
              }),
              MessageDeduplicationId: `${action}-${entityValue}-${
                permissionSetArn.toString().split("/")[2]
              }-${relatedGroups.Items?.[0].groupId}`,
              MessageGroupId: `${entityValue}-${
                permissionSetArn.toString().split("/")[2]
              }-${relatedGroups.Items?.[0].groupId}`,
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
            principalId: relatedGroups.Items?.[0].groupId,
            principalType: staticSSOPayload.PrincipalType,
            targetType: staticSSOPayload.TargetType,
            topicArn: processTargetAccountSMTopicArn + "",
            sourceRequestId: requestId,
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
        } else {
          // entityType is unknown, so ignoring the operation
          logger({
            handler: "linkTopicProcessor",
            logMode: "error",
            requestId: requestId,
            relatedData: `${linkData}`,
            status: requestStatus.FailedWithError,
            statusMessage: `Link topic processor ${action} operation completed in error as entityType is unknown`,
          });
        }
      } else if (adUsed === "true" && domainName !== "") {
        // Handling AD sync as the group does not yet exist within DDB',
        const listGroupsResult: ListGroupsCommandOutput =
          await identityStoreClientObject.send(
            new ListGroupsCommand({
              IdentityStoreId: identityStoreId,
              Filters: [
                {
                  AttributePath: "DisplayName",
                  AttributeValue: `${groupName}@${domainName}`,
                },
              ],
            })
          );
        if (listGroupsResult.Groups?.length !== 0) {
          const groupId = listGroupsResult.Groups?.[0].GroupId;
          await ddbDocClientObject.send(
            new PutCommand({
              TableName: groupsTable,
              Item: {
                groupName,
                groupId,
              },
            })
          );
          if (entityType === "account") {
            await sqsClientObject.send(
              new SendMessageCommand({
                QueueUrl: linkQueueUrl,
                MessageBody: JSON.stringify({
                  ssoParams: {
                    ...staticSSOPayload,
                    TargetId: entityValue,
                    PermissionSetArn: permissionSetArn,
                    PrincipalId: groupId,
                  },
                  actionType: action,
                  entityType: entityType,
                  tagKeyLookUp: "none",
                  sourceRequestId: requestId,
                }),
                MessageDeduplicationId: `${action}-${entityValue}-${
                  permissionSetArn.toString().split("/")[2]
                }-${groupId}`,
                MessageGroupId: `${entityValue}-${
                  permissionSetArn.toString().split("/")[2]
                }-${groupId}`,
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
              principalId: groupId + "",
              principalType: staticSSOPayload.PrincipalType,
              targetType: staticSSOPayload.TargetType,
              topicArn: processTargetAccountSMTopicArn + "",
              sourceRequestId: requestId,
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
          // No related groups found from AD sync for this link
          logger({
            handler: "linkTopicProcessor",
            logMode: "info",
            relatedData: `${linkData}`,
            requestId: requestId,
            status: requestStatus.Completed,
            statusMessage: `Link topic processor ${action} operation completed as no related groups found from AD sync for this link`,
          });
        }
      } else {
        // No related groups found for this link
        logger({
          handler: "linkTopicProcessor",
          logMode: "info",
          relatedData: `${linkData}`,
          requestId: requestId,
          status: requestStatus.Completed,
          statusMessage: `Link topic processor ${action} operation completed as no related groups found for this link`,
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

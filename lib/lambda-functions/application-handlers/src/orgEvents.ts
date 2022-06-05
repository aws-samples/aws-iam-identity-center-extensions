/*
Objective: Implement org event notifications
Trigger source: Org event notification topic which in turn
                receives event bridge notifications from Org
                main account for move account,create account
                and account tag type events
- assumes role in SSO account for calling SSO admin API
- determine the type of org event and resolve the
  relevant create and delete link operations
- Process the appropriate link operation
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

const {
  permissionSetArnTable,
  DdbTable,
  SSOAPIRoleArn,
  ISAPIRoleArn,
  linkQueueUrl,
  adUsed,
  domainName,
  errorNotificationsTopicArn,
  ssoRegion,
  provisionedLinksTable,
  supportNestedOU,
  orgListParentsRoleArn,
  AWS_REGION,
} = process.env;

// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { IdentitystoreClient } from "@aws-sdk/client-identitystore";
import {
  ListParentsCommand,
  OrganizationsClient,
} from "@aws-sdk/client-organizations";
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
  QueryCommand,
  QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
import { SNSEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import {
  ErrorMessage,
  requestStatus,
  StaticSSOPayload,
} from "../../helpers/src/interfaces";
import { logger, resolvePrincipal } from "../../helpers/src/utilities";
// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });
const sqsClientObject = new SQSClient({ region: AWS_REGION, maxAttempts: 2 });
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
const organizationsClientObject = new OrganizationsClient({
  region: "us-east-1",
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: orgListParentsRoleArn,
    },
  }),
  maxAttempts: 2,
});

//Error notification
const errorMessage: ErrorMessage = {
  Subject: "Error Processing Org event based link provisioning operation",
};

export const tagBasedDeProvisioning = async (
  instanceArn: string,
  passedTagKey: string,
  targetId: string,
  requestId: string
) => {
  const tagKeyLookUpValue = `${passedTagKey}^${targetId}`;
  const relatedProvisionedLinks: QueryCommandOutput =
    await ddbDocClientObject.send(
      // QueryCommand is a pagniated call, however the logic requires
      // checking only if the result set is greater than 0
      new QueryCommand({
        TableName: provisionedLinksTable,
        IndexName: "tagKeyLookUp",
        KeyConditionExpression: "#tagKeyLookUp = :tagKeyLookUp",
        ExpressionAttributeNames: { "#tagKeyLookUp": "tagKeyLookUp" },
        ExpressionAttributeValues: {
          ":tagKeyLookUp": tagKeyLookUpValue,
        },
      })
    );

  if (
    relatedProvisionedLinks.Items &&
    relatedProvisionedLinks.Items.length !== 0
  ) {
    await Promise.all(
      relatedProvisionedLinks.Items.map(async (Item) => {
        const parentLinkValue = Item.parentLink.toString();
        const parentLinkItems = parentLinkValue.split("@");
        const staticSSOPayload: StaticSSOPayload = {
          InstanceArn: instanceArn + "",
          TargetType: "AWS_ACCOUNT",
          PrincipalType: Item.principalType,
        };
        await sqsClientObject.send(
          new SendMessageCommand({
            QueueUrl: linkQueueUrl,
            MessageBody: JSON.stringify({
              ssoParams: {
                ...staticSSOPayload,
                PrincipalId: parentLinkItems[0],
                PermissionSetArn: `arn:aws:sso:::permissionSet/${parentLinkItems[2]}/${parentLinkItems[3]}`,
                TargetId: targetId,
              },
              actionType: "delete",
              entityType: "account_tag",
              tagKeyLookUp: `${passedTagKey}^${targetId}`,
              sourceRequestId: requestId,
            }),
            /*  MessageDeduplicationId: `delete-${targetId}-${parentLinkItems[3]}-${parentLinkItems[0]}`, */
            MessageGroupId: `${targetId}-${parentLinkItems[3]}-${parentLinkItems[0]}`,
          })
        );
        logger({
          handler: "orgEventsProcessor",
          logMode: "info",
          requestId: requestId,
          relatedData: `${parentLinkValue}`,
          status: requestStatus.Completed,
          statusMessage: `OrgEvents - proactive deprovisioning due to untag resource posted to link manager topic`,
        });
      })
    );
  } else {
    // Ignore if a tag that's not part of the provsionedlinks
    // is deleted from the account
    logger({
      handler: "orgEventsProcessor",
      logMode: "info",
      status: requestStatus.Completed,
      requestId: requestId,
      statusMessage: `OrgEvents - ignoring de-provisioning logic check as the tag created/updated/deleted is not part of provisioned links`,
    });
  }
};

export const orgEventProvisioning = async (
  instanceArn: string,
  targetId: string,
  actionType: string,
  entityData: string,
  entityType: string,
  identityStoreId: string,
  requestId: string
) => {
  let tagKeyLookupValue = "none";

  if (entityType === "account_tag") {
    tagKeyLookupValue = `${entityData.split("^")[0]}^${targetId}`;
  }

  const relatedLinks: QueryCommandOutput = await ddbDocClientObject.send(
    // QueryCommand is a pagniated call, however the logic requires
    // checking only if the result set is greater than 0
    new QueryCommand({
      TableName: DdbTable,
      IndexName: "awsEntityData",
      KeyConditionExpression: "#awsEntityData = :awsEntityData",
      ExpressionAttributeNames: { "#awsEntityData": "awsEntityData" },
      ExpressionAttributeValues: { ":awsEntityData": entityData },
    })
  );

  if (relatedLinks.Items && relatedLinks.Items?.length !== 0) {
    await Promise.all(
      relatedLinks.Items.map(async (Item) => {
        const { principalType, principalName } = Item;
        const permissionSetFetch: GetCommandOutput =
          await ddbDocClientObject.send(
            new GetCommand({
              TableName: permissionSetArnTable,
              Key: {
                permissionSetName: Item.permissionSetName,
              },
            })
          );
        if (permissionSetFetch.Item) {
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
            // Resolved the principal ID and proceeding with the operation
            const staticSSOPayload: StaticSSOPayload = {
              InstanceArn: instanceArn + "",
              TargetType: "AWS_ACCOUNT",
              PrincipalType: principalType,
            };
            await sqsClientObject.send(
              new SendMessageCommand({
                QueueUrl: linkQueueUrl,
                MessageBody: JSON.stringify({
                  ssoParams: {
                    ...staticSSOPayload,
                    PrincipalId: principalId,
                    PermissionSetArn: permissionSetFetch.Item.permissionSetArn,
                    TargetId: targetId,
                  },
                  actionType: actionType,
                  entityType: entityType,
                  tagKeyLookUp: tagKeyLookupValue,
                  sourceRequestId: requestId,
                }),
                /*  MessageDeduplicationId: `${actionType}-${targetId}-${
                  permissionSetFetch.Item.permissionSetArn
                    .toString()
                    .split("/")[2]
                }-${principalId}`, */
                MessageGroupId: `${targetId}-${
                  permissionSetFetch.Item.permissionSetArn
                    .toString()
                    .split("/")[2]
                }-${principalId}`,
              })
            );
            logger({
              handler: "orgEventsProcessor",
              logMode: "info",
              relatedData: `${entityData}`,
              status: requestStatus.Completed,
              requestId: requestId,
              statusMessage: `OrgEvents - link provisioned to link manager topic`,
            });
          } else {
            // No related principals found for this link
            logger({
              handler: "orgEventsProcessor",
              logMode: "info",
              relatedData: `${entityData}`,
              status: requestStatus.Aborted,
              requestId: requestId,
              statusMessage: `OrgEvents - no related principals found`,
            });
          }
        } else {
          // No related permission sets found for this link
          logger({
            handler: "orgEventsProcessor",
            logMode: "info",
            relatedData: `${entityData}`,
            status: requestStatus.Aborted,
            requestId: requestId,
            statusMessage: `OrgEvents - no related permission sets found`,
          });
        }
      })
    );
  } else if (entityType === "account_tag") {
    // We need to determine if an account tag has been
    // updated to trigger de-provisioning logic
    logger({
      handler: "orgEventsProcessor",
      logMode: "info",
      relatedData: `${entityData}`,
      requestId: requestId,
      status: requestStatus.Completed,
      statusMessage: `OrgEvents - conducting de-provsioning check for entityData ${entityData} on targetaccount ID ${targetId} as an account tag is now updated`,
    });
    await tagBasedDeProvisioning(
      instanceArn,
      entityData.split("^")[0],
      targetId,
      requestId
    );
  } else {
    // No related links for the org event being processed
  }
};

export const handler = async (event: SNSEvent) => {
  const requestId = uuidv4().toString();
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
    const identityStoreId =
      resolvedInstances.Instances?.[0].IdentityStoreId + "";
    if (message.detail.eventName === "CreateAccountResult") {
      await orgEventProvisioning(
        instanceArn,
        message.detail.serviceEventDetails.createAccountStatus.accountId,
        "create",
        "all",
        "root",
        identityStoreId,
        requestId
      );
    } else if (message.detail.eventName === "MoveAccount") {
      /**
       * If nesteOU support is enabled, then the function removes any related
       * account assignments that has been provisioned for any of the parents of
       * the old OU until root. It would also assign any related account
       * assignments for any of the parents of the new OU until root. Both
       * removal and addition is inclusive of the actual OU ID and exclusive of
       * root If nested OU support is not enabled, then the function would
       * simply remove and add any related account assignments for the old and new OU's
       */
      logger({
        handler: "orgEventsProcessor",
        logMode: "info",
        relatedData: `${message.detail.requestParameters.accountId}`,
        status: requestStatus.InProgress,
        requestId: requestId,
        statusMessage: `OrgEvents - org move, determining the list of OU ID's`,
      });
      let oldParentsList: Array<string> = [];
      let newParentsList: Array<string> = [];
      oldParentsList.push(message.detail.requestParameters.sourceParentId);
      newParentsList.push(message.detail.requestParameters.destinationParentId);
      if (supportNestedOU === "true") {
        logger({
          handler: "orgEventsProcessor",
          logMode: "info",
          relatedData: `${message.detail.requestParameters.accountId}`,
          status: requestStatus.InProgress,
          requestId: requestId,
          statusMessage: `OrgEvents - org move, nestedOU support enabled, traversing through the org tree for delta`,
        });
        /**
         * Orgs API listParents call only returns the parent up to one level up.
         * The below code would traverse the tree until it reaches root
         */
        if (
          !message.detail.requestParameters.sourceParentId
            .toString()
            .match(/r-.*/)
        ) {
          let loop = true;
          let previousParentId =
            message.detail.requestParameters.sourceParentId;
          while (loop) {
            const currentParentOutput = await organizationsClientObject.send(
              new ListParentsCommand({
                ChildId: previousParentId,
              })
            );

            if (currentParentOutput.Parents) {
              if (currentParentOutput.Parents[0].Type === "ROOT") {
                loop = false;
              } else {
                if (currentParentOutput.Parents[0].Id) {
                  oldParentsList.push(currentParentOutput.Parents[0].Id);
                  previousParentId = currentParentOutput.Parents[0].Id;
                }
              }
            } else {
              loop = false;
            }
          }
        }

        if (
          !message.detail.requestParameters.destinationParentId
            .toString()
            .match(/r-.*/)
        ) {
          let loop = true;
          let previousParentId =
            message.detail.requestParameters.destinationParentId;
          while (loop) {
            const currentParentOutput = await organizationsClientObject.send(
              new ListParentsCommand({
                ChildId: previousParentId,
              })
            );

            if (currentParentOutput.Parents) {
              if (currentParentOutput.Parents[0].Type === "ROOT") {
                loop = false;
              } else {
                if (currentParentOutput.Parents[0].Id) {
                  newParentsList.push(currentParentOutput.Parents[0].Id);
                  previousParentId = currentParentOutput.Parents[0].Id;
                }
              }
            } else {
              loop = false;
            }
          }
        }
        /** Remove root parents from both old and new parents list */
        oldParentsList = oldParentsList.filter(
          (parent) => !parent.match(/r-.*/)
        );
        newParentsList = newParentsList.filter(
          (parent) => !parent.match(/r-.*/)
        );
      }

      const parentsToRemove: Array<string> = oldParentsList.filter(
        (parent) => !newParentsList.includes(parent)
      );
      const parentsToAdd: Array<string> = newParentsList.filter(
        (parent) => !oldParentsList.includes(parent)
      );
      logger({
        handler: "orgEventsProcessor",
        logMode: "info",
        relatedData: `${message.detail.requestParameters.accountId}`,
        status: requestStatus.InProgress,
        requestId: requestId,
        statusMessage: `OrgEvents - account move, list of OU ID's calculated for de-provisioning: ${JSON.stringify(
          parentsToRemove
        )}`,
      });
      logger({
        handler: "orgEventsProcessor",
        logMode: "info",
        relatedData: `${message.detail.requestParameters.accountId}`,
        status: requestStatus.InProgress,
        requestId: requestId,
        statusMessage: `OrgEvents - account move, list of OU ID's calculated for provisioning: ${JSON.stringify(
          parentsToAdd
        )}`,
      });
      /** Start processing deletion of any related account assignments for old parents list */
      for (const parent of parentsToRemove) {
        await orgEventProvisioning(
          instanceArn,
          message.detail.requestParameters.accountId,
          "delete",
          parent,
          "ou_id",
          identityStoreId,
          requestId
        );
      }
      /** Start processing addition of any related account assignments for new parents list */
      for (const parent of parentsToAdd) {
        await orgEventProvisioning(
          instanceArn,
          message.detail.requestParameters.accountId,
          "create",
          parent,
          "ou_id",
          identityStoreId,
          requestId
        );
      }
    } else if (message["detail-type"] === "Tag Change on Resource") {
      // When tag changes are recieved by the lambda
      // handler it would contain changed-tag-keys
      // and the current set of tag key value pairs
      // The logic first determines if a tag is
      // deleted (or) created (or) updated on the account
      // If a tag key is deleted, the solution looks up
      // provisionedLinks table to determine if there were
      // any links provisioned with that tag key and if the
      // result length is more than 0, trigger de-provisioning
      // If a tag key is created/updated, then the solution
      // looks up linksTable with entityData and determines if there's
      // a link that matches this entityData. If there is a link that
      // matches this entityData, the solution triggers provisioning
      // logic with the link it retreived. If there's no link that
      // matches this entityData, the solutions looks up provisionedlinks
      // table to determine if there's an existing link with the tagkey
      // If there is a provisioned link existing this indicates that an
      // account had a scope tag updates, so the solution triggers
      // de-provisioning logic
      const { detail, resources } = message;
      const { tags } = detail;
      const changedTagKeys = detail["changed-tag-keys"];
      await Promise.all(
        changedTagKeys.map(async (changedTagKey: string) => {
          if (!Object.prototype.hasOwnProperty.call(tags, changedTagKey)) {
            // Account tag has been deleted
            logger({
              handler: "orgEventsProcessor",
              logMode: "info",
              relatedData: `${changedTagKey}`,
              status: requestStatus.Completed,
              statusMessage: `OrgEvents - tag change , delta is a delete operation`,
            });
            await tagBasedDeProvisioning(
              instanceArn,
              changedTagKey,
              resources[0].split("/")[2],
              requestId
            );
          } else if (
            Object.prototype.hasOwnProperty.call(tags, changedTagKey)
          ) {
            // Account tag is either created/updated
            logger({
              handler: "orgEventsProcessor",
              logMode: "info",
              relatedData: `${changedTagKey}`,
              status: requestStatus.Completed,
              requestId: requestId,
              statusMessage: `OrgEvents - tag change , delta is a create/update operation`,
            });
            const tagValue = tags[`${changedTagKey}`];
            await orgEventProvisioning(
              instanceArn,
              resources[0].split("/")[2],
              "create",
              `${changedTagKey}^${tagValue}`,
              "account_tag",
              identityStoreId,
              requestId
            );
          }
        })
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
    logger({
      handler: "orgEventsProcessor",
      logMode: "error",
      status: requestStatus.FailedWithException,
      requestId: requestId,
      statusMessage: `org events processor failed with exception: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`,
    });
  }
};

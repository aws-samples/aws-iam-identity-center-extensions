/**
 * Objective: Implement org event notifications Trigger source: Org event
 * notification topic which in turn receives event bridge notifications from Org
 * main account for move account,create account and account tag type events
 *
 * - Assumes role in SSO account for calling SSO admin API
 * - Determine the type of org event and resolve the relevant create and delete
 *   link operations
 * - Process the appropriate link operation
 * - Catch all failures in a generic exception block and post the error details to
 *   error notifications topics
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
  functionLogMode,
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;

import {
  DynamoDBClient,
  DynamoDBServiceException,
} from "@aws-sdk/client-dynamodb";
import {
  IdentitystoreClient,
  IdentitystoreServiceException,
} from "@aws-sdk/client-identitystore";
import {
  ListParentsCommand,
  OrganizationsClient,
  OrganizationsServiceException,
} from "@aws-sdk/client-organizations";
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
import {
  ListInstancesCommand,
  ListInstancesCommandOutput,
  SSOAdminClient,
  SSOAdminServiceException,
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
  logModes,
  requestStatus,
  StaticSSOPayload,
} from "../../helpers/src/interfaces";
import {
  constructExceptionMessage,
  constructExceptionMessageforLogger,
  logger,
  resolvePrincipal,
} from "../../helpers/src/utilities";

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

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
const messageSubject = "Exception in org events trigger processing";
let requestIdValue = "";
let orgEventDataValue = "";

export const tagBasedDeProvisioning = async (
  instanceArn: string,
  passedTagKey: string,
  targetId: string,
  requestId: string
) => {
  logger(
    {
      handler: handlerName,
      logMode: logModes.Info,
      requestId: requestId,
      status: requestStatus.InProgress,
      relatedData: passedTagKey,
      statusMessage: `Validating if tag based de-provisioining is required for tagKey ${passedTagKey} on accountID ${targetId}`,
    },
    functionLogMode
  );
  const tagKeyLookUpValue = `${passedTagKey}^${targetId}`;
  logger(
    {
      handler: handlerName,
      logMode: logModes.Debug,
      requestId: requestId,
      status: requestStatus.InProgress,
      relatedData: passedTagKey,
      statusMessage: `Querying if there are related provisioned links for this tagKeylookupValue ${tagKeyLookUpValue}`,
    },
    functionLogMode
  );
  const relatedProvisionedLinks: QueryCommandOutput =
    await ddbDocClientObject.send(
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
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestId,
        status: requestStatus.InProgress,
        relatedData: passedTagKey,
        statusMessage: `Determined there are ${relatedProvisionedLinks.Items.length} no of related provisioned links for tagKeyLookUpValue ${tagKeyLookUpValue}`,
      },
      functionLogMode
    );

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
            MessageGroupId: targetId.slice(-1),
          })
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.Completed,
            relatedData: targetId,
            statusMessage: `Triggering a deleteAccountAssignment operation as the tag key ${passedTagKey} that provisioned this access is removed from account ${targetId}`,
          },
          functionLogMode
        );
      })
    );
  } else {
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestId,
        status: requestStatus.Completed,
        relatedData: targetId,
        statusMessage: `Tag ${passedTagKey} created/updated/deleted is not part of the provisioned account assignments, so ignoring this operation`,
      },
      functionLogMode
    );
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
  logger(
    {
      handler: handlerName,
      logMode: logModes.Info,
      requestId: requestId,
      status: requestStatus.InProgress,
      relatedData: entityData,
      statusMessage: `Initiating org events triggered provisioning for entityType ${entityType} , entityData ${entityData} for accountID ${targetId} and action ${actionType}`,
    },
    functionLogMode
  );

  if (entityType === "account_tag") {
    tagKeyLookupValue = `${entityData.split("^")[0]}^${targetId}`;
    logger(
      {
        handler: handlerName,
        logMode: logModes.Debug,
        requestId: requestId,
        status: requestStatus.InProgress,
        relatedData: entityData,
        statusMessage: `Updated tagKeyLookUpValue to ${tagKeyLookupValue} as entityType is account_tag`,
      },
      functionLogMode
    );
  }

  const relatedLinks: QueryCommandOutput = await ddbDocClientObject.send(
    new QueryCommand({
      TableName: DdbTable,
      IndexName: "awsEntityData",
      KeyConditionExpression: "#awsEntityData = :awsEntityData",
      ExpressionAttributeNames: { "#awsEntityData": "awsEntityData" },
      ExpressionAttributeValues: { ":awsEntityData": entityData },
    })
  );

  if (relatedLinks.Items && relatedLinks.Items?.length !== 0) {
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestId,
        status: requestStatus.InProgress,
        relatedData: entityData,
        statusMessage: `Determined there are ${relatedLinks.Items.length} no of related account assignment operations for entityData ${entityData}`,
      },
      functionLogMode
    );
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
          let principalNameToLookUp = principalName;
          logger(
            {
              handler: handlerName,
              logMode: logModes.Debug,
              requestId: requestId,
              status: requestStatus.InProgress,
              relatedData: entityData,
              statusMessage: `Computed principalNametoLookup as ${principalNameToLookUp}`,
            },
            functionLogMode
          );

          if (adUsed === "true" && domainName !== "") {
            principalNameToLookUp = `${principalName}@${domainName}`;
            logger(
              {
                handler: handlerName,
                logMode: logModes.Debug,
                requestId: requestId,
                status: requestStatus.InProgress,
                relatedData: entityData,
                statusMessage: `Deployment uses AD for SSO identity store, using domainName ${domainName}, computed principalNametoLookup as ${principalNameToLookUp}`,
              },
              functionLogMode
            );
          }
          const principalId = await resolvePrincipal(
            identityStoreId,
            identityStoreClientObject,
            principalType,
            principalNameToLookUp
          );

          if (principalId !== "0") {
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestId,
                status: requestStatus.InProgress,
                relatedData: entityData,
                statusMessage: `For principal ${principalNameToLookUp} , resolved principal ID as ${principalId} from AWS SSO Identity store`,
              },
              functionLogMode
            );
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
                MessageGroupId: targetId.slice(-1),
              })
            );

            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestId,
                status: requestStatus.Completed,
                relatedData: entityData,
                statusMessage: `Posted ${actionType} operation to account assignments handler for accountID ${targetId} , permissionSetArn ${permissionSetFetch.Item.permissionSetArn}`,
              },
              functionLogMode
            );
          } else {
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestId,
                status: requestStatus.Completed,
                relatedData: entityData,
                statusMessage: `Ignoring this org event triggered account assignment operation as related principals are not found`,
              },
              functionLogMode
            );
          }
        } else {
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestId,
              status: requestStatus.Completed,
              relatedData: entityData,
              statusMessage: `Ignoring this org event triggered account assignment operation as related permission sets are not found`,
            },
            functionLogMode
          );
        }
      })
    );
  } else if (entityType === "account_tag") {
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestId,
        status: requestStatus.InProgress,
        relatedData: entityData,
        statusMessage: `Conducting de-provisioning check for entityData ${entityData} on targetaccountID ${targetId} as an account tag is now updated`,
      },
      functionLogMode
    );
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
  requestIdValue = requestId;
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestId,
        status: requestStatus.InProgress,
        statusMessage: `Initiating org event triggered account assignment operation`,
      },
      functionLogMode
    );

    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
    const identityStoreId =
      resolvedInstances.Instances?.[0].IdentityStoreId + "";
    logger(
      {
        handler: handlerName,
        logMode: logModes.Debug,
        requestId: requestId,
        status: requestStatus.InProgress,
        relatedData: identityStoreId,
        statusMessage: `Resolved identityStoreID ${identityStoreId} for instanceArn ${instanceArn}`,
      },
      functionLogMode
    );

    if (message.detail.eventName === "CreateAccountResult") {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          status: requestStatus.InProgress,
          relatedData:
            message.detail.serviceEventDetails.createAccountStatus.accountId,
          statusMessage: `Triggered createAccountResult based provisioning logic for accountID ${message.detail.serviceEventDetails.createAccountStatus.accountId} and scope type as root`,
        },
        functionLogMode
      );
      orgEventDataValue = `createAccount for accountID ${message.detail.serviceEventDetails.createAccountStatus.accountId}`;
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
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          status: requestStatus.InProgress,
          relatedData: message.detail.requestParameters.accountId,
          statusMessage: `Triggered MoveAccount based provisioning logic for accountID ${message.detail.requestParameters.accountId}`,
        },
        functionLogMode
      );

      orgEventDataValue = `moveAccount for account moving from old OU_ID ${message.detail.requestParameters.sourceParentId} to new OU_ID ${message.detail.requestParameters.destinationParentId}`;
      let oldParentsList: Array<string> = [];
      let newParentsList: Array<string> = [];
      oldParentsList.push(message.detail.requestParameters.sourceParentId);
      newParentsList.push(message.detail.requestParameters.destinationParentId);
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          status: requestStatus.InProgress,
          relatedData: message.detail.requestParameters.accountId,
          statusMessage: `Compueted old Parents List`,
        },
        functionLogMode
      );
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          status: requestStatus.InProgress,
          relatedData: message.detail.requestParameters.accountId,
          statusMessage: `Compueted new Parents List`,
        },
        functionLogMode
      );

      if (supportNestedOU === "true") {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.InProgress,
            relatedData: message.detail.requestParameters.accountId,
            statusMessage: `Nested OU support enabled, traversing through the org tree for delta`,
          },
          functionLogMode
        );
        /**
         * Orgs API listParents call only returns the parent up to one level up.
         * The below code would traverse the tree until it reaches root
         */
        if (
          !message.detail.requestParameters.sourceParentId
            .toString()
            .match(/r-.*/)
        ) {
          logger(
            {
              handler: handlerName,
              logMode: logModes.Debug,
              requestId: requestId,
              status: requestStatus.InProgress,
              relatedData: message.detail.requestParameters.accountId,
              statusMessage: `Validated that sourceParent is not a root, so traversing all the result OU's from old parent`,
            },
            functionLogMode
          );
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
          logger(
            {
              handler: handlerName,
              logMode: logModes.Debug,
              requestId: requestId,
              status: requestStatus.InProgress,
              relatedData: message.detail.requestParameters.accountId,
              statusMessage: `Validated that destinationParent is not a root, so traversing all the result OU's from new parent`,
            },
            functionLogMode
          );
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
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          relatedData: message.detail.requestParameters.accountId,
          status: requestStatus.InProgress,
          requestId: requestId,
          statusMessage: `OrgEvents - account move, list of OU ID's calculated for de-provisioning: ${JSON.stringify(
            parentsToRemove
          )}`,
        },
        functionLogMode
      );
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          relatedData: message.detail.requestParameters.accountId,
          status: requestStatus.InProgress,
          requestId: requestId,
          statusMessage: `OrgEvents - account move, list of OU ID's calculated for provisioning: ${JSON.stringify(
            parentsToAdd
          )}`,
        },
        functionLogMode
      );
      /** Start processing deletion of any related account assignments for old parents list */
      for (const parent of parentsToRemove) {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            relatedData: message.detail.requestParameters.accountId,
            status: requestStatus.InProgress,
            requestId: requestId,
            statusMessage: `Processing delete for any related accountassignment for ou_id ${parent}`,
          },
          functionLogMode
        );
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
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            relatedData: message.detail.requestParameters.accountId,
            status: requestStatus.InProgress,
            requestId: requestId,
            statusMessage: `Processing add for any related accountassignment for ou_id ${parent}`,
          },
          functionLogMode
        );
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
      /**
       * // When tag changes are recieved by the lambda // handler it would
       * contain changed-tag-keys // and the current set of tag key value pairs
       * // The logic first determines if a tag is // deleted (or) created (or)
       * updated on the account // If a tag key is deleted, the solution looks
       * up // provisionedLinks table to determine if there were // any links
       * provisioned with that tag key and if the // result length is more than
       * 0, trigger de-provisioning // If a tag key is created/updated, then the
       * solution // looks up linksTable with entityData and determines if
       * there's // a link that matches this entityData. If there is a link that
       * // matches this entityData, the solution triggers provisioning // logic
       * with the link it retreived. If there's no link that // matches this
       * entityData, the solutions looks up provisionedlinks // table to
       * determine if there's an existing link with the tagkey // If there is a
       * provisioned link existing this indicates that an // account had a scope
       * tag updates, so the solution triggers // de-provisioning logic
       */

      const { detail, resources } = message;
      const { tags } = detail;
      const changedTagKeys = detail["changed-tag-keys"];
      orgEventDataValue = `tagChange on resource for changedTagKeys ${JSON.stringify(
        changedTagKeys
      )}`;
      await Promise.all(
        changedTagKeys.map(async (changedTagKey: string) => {
          if (!Object.prototype.hasOwnProperty.call(tags, changedTagKey)) {
            // Account tag has been deleted
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                relatedData: changedTagKey,
                status: requestStatus.InProgress,
                requestId: requestId,
                statusMessage: `Determined tag change is a delta operation`,
              },
              functionLogMode
            );
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
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                relatedData: changedTagKey,
                status: requestStatus.InProgress,
                requestId: requestId,
                statusMessage: `Determined tag change is a create/update operation`,
              },
              functionLogMode
            );
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
    if (
      err instanceof DynamoDBServiceException ||
      err instanceof IdentitystoreServiceException ||
      err instanceof OrganizationsServiceException ||
      err instanceof SNSServiceException ||
      err instanceof SQSServiceException ||
      err instanceof SSOAdminServiceException
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
            orgEventDataValue
          ),
        })
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
          orgEventDataValue
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
            orgEventDataValue
          ),
        })
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
          orgEventDataValue
        ),
      });
    }
  }
};

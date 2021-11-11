/*
Objective: Implement org event notifications
Trigger source: Org event notification topic which in turn
                receives event bridge notifications from Org
                main account for move account,create account
                and account tag type events
- assumes role in SSO account for calling SSO admin API
- determine the type of org event and resolve the
  relevant create and delete link operations
- determine if there are related links
    already provisioned by looking up
    links table
  - if there are related links, then
    - for each related link
    - determine if permission set referenced
      in the link is already provisioned by
      looking up permissionsetArn ddb table
      - if the permission set exists, then
        - look up in the groups ddb table,
           if the group referenced in the record exists
            - if the group exists
              post the link operation message to
              link manager topic
            - if the group does not exist, verify if the
              SSO configuration is using Active Directory
                - if it uses AD configuration
                     - resolve the group ID
                       (as SSO generates this just-in-time)
                       by calling identity store API
                       and post link operation message to
                       link manager topic
                - if it does not use Active Directory configuration,
                  stop processing as we won't be able to proceed
                  without groupID which is the principal Arn
      - if permission set does not exist, stop the process
    - if there are no related links, then
      stop the operation here
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

const {
  permissionSetArnTable,
  DdbTable,
  SSOAPIRoleArn,
  ISAPIRoleArn,
  groupsTable,
  topicArn,
  adUsed,
  domainName,
  errorNotificationsTopicArn,
  ssoRegion,
  provisionedLinksTable,
  AWS_REGION,
} = process.env;

// SDK and third party client imports
import { DynamoDBClient, QueryCommandOutput } from "@aws-sdk/client-dynamodb";
import {
  IdentitystoreClient,
  ListGroupsCommand,
  ListGroupsCommandOutput,
} from "@aws-sdk/client-identitystore";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
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
} from "@aws-sdk/lib-dynamodb";
import { SNSEvent } from "aws-lambda";
import { ErrorMessage, StaticSSOPayload } from "../../helpers/src/interfaces";

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
  Subject: "Error Processing Org event based link provisioning operation",
};

export const tagBasedDeProvisioning = async (
  staticssoPayload: StaticSSOPayload,
  passedTagKey: string,
  targetId: string
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
        const parentLinkValue = Item.parentLink.S?.toString() + "";
        const parentLinkItems = parentLinkValue.split("@");
        await snsClientObject.send(
          new PublishCommand({
            TopicArn: topicArn,
            Message: JSON.stringify({
              ssoParams: {
                ...staticssoPayload,
                PrincipalId: parentLinkItems[0],
                PermissionSetArn: `arn:aws:sso:::permissionSet/${parentLinkItems[2]}/${parentLinkItems[3]}`,
                TargetId: targetId,
              },
              actionType: "delete",
              entityType: "account_tag",
              tagKeyLookUp: `${passedTagKey}^${targetId}`,
            }),
          })
        );
        console.log(
          `Processed proactive deprovisioning due to untagresource on parentLink ${parentLinkValue}`
        );
      })
    );
  } else {
    // Ignore if a tag that's not part of the provsionedlinks
    // is deleted from the account
    console.log(
      "In org events, ignoring de-provisioning logic check as the tag created/updated/deleted is not part of provisioned links"
    );
  }
};

export const orgEventProvisioning = async (
  staticssoPayload: StaticSSOPayload,
  targetId: string,
  actionType: string,
  entityData: string,
  entityType: string,
  identityStoreId: string
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
        const { groupName } = Item;
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
          const relatedGroups: QueryCommandOutput =
            await ddbDocClientObject.send(
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

          if (relatedGroups.Items && relatedGroups.Items.length !== 0) {
            await snsClientObject.send(
              new PublishCommand({
                TopicArn: topicArn,
                Message: JSON.stringify({
                  ssoParams: {
                    ...staticssoPayload,
                    PrincipalId: relatedGroups.Items[0].groupId,
                    PermissionSetArn: permissionSetFetch.Item.permissionSetArn,
                    TargetId: targetId,
                  },
                  actionType: actionType,
                  entityType: entityType,
                  tagKeyLookUp: tagKeyLookupValue,
                }),
              })
            );
            console.log(
              `Processed provisioning of links as there are related links for ${entityData} of type ${entityType} found`
            );
          } else if (adUsed === "true" && domainName !== "") {
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
            if (
              listGroupsResult.Groups &&
              listGroupsResult.Groups?.length !== 0
            ) {
              // Resolved the AD group ID and proceeding with the operation
              const groupId = listGroupsResult.Groups[0].GroupId;
              await ddbDocClientObject.send(
                new PutCommand({
                  TableName: groupsTable,
                  Item: {
                    groupName: groupName,
                    groupId: groupId,
                  },
                })
              );
              await snsClientObject.send(
                new PublishCommand({
                  TopicArn: topicArn,
                  Message: JSON.stringify({
                    ssoParams: {
                      ...staticssoPayload,
                      PrincipalId: groupId,
                      PermissionSetArn:
                        permissionSetFetch.Item.permissionSetArn,
                      TargetId: targetId,
                    },
                    actionType: actionType,
                    entityType: entityType,
                    tagKeyLookUp: tagKeyLookupValue,
                  }),
                })
              );
            } else {
              // No related groups found from AD sync for this link
              console.log(
                `Ignoring org event for ${entityData} of type ${entityType} as related groups are not found`
              );
            }
          } else {
            // Either the permissionset or the group
            // pertaining to the link have not been provisioned yet
            console.log(
              `Ignoring org event for ${entityData} of type ${entityType} as related groups or permission set are not found`
            );
          }
        }
      })
    );
  } else if (entityType === "account_tag") {
    // We need to determine if an account tag has been
    // updated to trigger de-provisioning logic
    console.log(
      `In orgevents, conducting de-provsioning check for entityData ${entityData} on targetaccount ID ${targetId} as an account tag is now updated`
    );
    await tagBasedDeProvisioning(
      staticssoPayload,
      entityData.split("^")[0],
      targetId
    );
  } else {
    // No related links for the org event being processed
  }
};

export const handler = async (event: SNSEvent) => {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
    const identityStoreId =
      resolvedInstances.Instances?.[0].IdentityStoreId + "";
    const staticSSOPayload: StaticSSOPayload = {
      InstanceArn: instanceArn + "",
      TargetType: "AWS_ACCOUNT",
      PrincipalType: "GROUP",
    };
    if (message.detail.eventName === "CreateAccountResult") {
      await orgEventProvisioning(
        staticSSOPayload,
        message.detail.serviceEventDetails.createAccountStatus.accountId,
        "create",
        "all",
        "root",
        identityStoreId
      );
    } else if (message.detail.eventName === "MoveAccount") {
      await orgEventProvisioning(
        staticSSOPayload,
        message.detail.requestParameters.accountId,
        "delete",
        message.detail.requestParameters.sourceParentId,
        "ou_id",
        identityStoreId
      );
      await orgEventProvisioning(
        staticSSOPayload,
        message.detail.requestParameters.accountId,
        "create",
        message.detail.requestParameters.destinationParentId,
        "ou_id",
        identityStoreId
      );
    } else if (message["detail-type"] === "Tag Change on Resource") {
      console.log("In org events, received tag change on account");
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
            console.log(
              `Determined that the tag change delta for ${changedTagKey} is a delete operation`
            );
            await tagBasedDeProvisioning(
              staticSSOPayload,
              changedTagKey,
              resources[0].split("/")[2]
            );
          } else if (
            Object.prototype.hasOwnProperty.call(tags, changedTagKey)
          ) {
            // Account tag is either created/updated
            console.log(
              `Determined that the tag change delta for ${changedTagKey} is a create/update operation`
            );
            await orgEventProvisioning(
              staticSSOPayload,
              resources[0].split("/")[2],
              "create",
              `${changedTagKey}^${tags[`${changedTagKey}`]}`,
              "account_tag",
              identityStoreId
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
    console.error(
      `Exception when processing org events handling: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`
    );
  }
};

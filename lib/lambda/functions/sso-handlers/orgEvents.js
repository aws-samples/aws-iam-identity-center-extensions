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
const { fromTemporaryCredentials } = require('@aws-sdk/credential-providers');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const {
  SSOAdminClient,
  ListInstancesCommand,
} = require('@aws-sdk/client-sso-admin');
const {
  IdentitystoreClient,
  ListGroupsCommand,
} = require('@aws-sdk/client-identitystore');

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

const errorParams = {
  TopicArn: errorNotificationsTopicArn,
};
const errorMessage = {};
errorMessage.Subject = 'Error Processing Org event based link provisioning operation';

const processAccountDeProvisioning = async (
  passedTagKey,
  passedParams,
  passedSSOParams,
) => {
  const params = passedParams;
  const ssoParams = passedSSOParams;
  const tagKeyLookUpValue = `${passedTagKey}^${ssoParams.TargetId}`;
  const relatedProvisionedLinks = await ddbDocClientObject.send(
    // QueryCommand is a pagniated call, however the logic requires
    // checking only if the result set is greater than 0
    new QueryCommand({
      TableName: provisionedLinksTable,
      IndexName: 'tagKeyLookUp',
      KeyConditionExpression: '#tagKeyLookUp = :tagKeyLookUp',
      ExpressionAttributeNames: { '#tagKeyLookUp': 'tagKeyLookUp' },
      ExpressionAttributeValues: {
        ':tagKeyLookUp': tagKeyLookUpValue,
      },
    }),
  );

  if (relatedProvisionedLinks.Items.length !== 0) {
    await Promise.all(
      relatedProvisionedLinks.Items.map(async (Item) => {
        const { parentLink } = Item;
        const parentLinkItems = parentLink.split('@');
        // eslint-disable-next-line prefer-destructuring
        ssoParams.PrincipalId = parentLinkItems[0];
        // eslint-disable-next-line prefer-destructuring
        ssoParams.PermissionSetArn = `arn:aws:sso:::permissionSet/${parentLinkItems[2]}/${parentLinkItems[3]}`;
        const messageParams = {
          ssoParams,
          actionType: 'delete',
          entityType: 'account_tag',
          tagKeyLookUp: `${passedTagKey}^${ssoParams.TargetId}`,
        };
        params.Message = JSON.stringify(messageParams);
        await snsClientObject.send(new PublishCommand(params));
        console.log(
          `Processed proactive deprovisioning due to untagresource on parentLink ${parentLink}`,
        );
      }),
    );
  } else {
    // Ignore if a tag that's not part of the provsionedlinks
    // is deleted from the account
    console.log(
      'In org events, ignoring de-provisioning logic check as the tag created/updated/deleted is not part of provisioned links',
    );
  }
};

const processNotifications = async (
  action,
  passedParams,
  passedSSOParams,
  entityData,
  entityType,
  identityStoreId,
) => {
  const params = passedParams;
  const ssoParams = passedSSOParams;
  let tagKeyLookupValue = 'none';

  if (entityType === 'account_tag') {
    tagKeyLookupValue = `${entityData.split('^')[0]}^${ssoParams.TargetId}`;
  }

  try {
    const relatedLinks = await ddbDocClientObject.send(
      // QueryCommand is a pagniated call, however the logic requires
      // checking only if the result set is greater than 0
      new QueryCommand({
        TableName: DdbTable,
        IndexName: 'awsEntityData',
        KeyConditionExpression: '#awsEntityData = :awsEntityData',
        ExpressionAttributeNames: { '#awsEntityData': 'awsEntityData' },
        ExpressionAttributeValues: { ':awsEntityData': entityData },
      }),
    );
    if (relatedLinks.Items.length !== 0) {
      await Promise.all(
        relatedLinks.Items.map(async (Item) => {
          const { groupName } = Item;
          const permissionSetFetch = await ddbDocClientObject.send(
            new GetCommand({
              TableName: permissionSetArnTable,
              Key: {
                permissionSetName: Item.permissionSetName,
              },
            }),
          );
          if (permissionSetFetch.Item) {
            ssoParams.PermissionSetArn = permissionSetFetch.Item.permissionSetArn;
            const relatedGroups = await ddbDocClientObject.send(
              // QueryCommand is a pagniated call, however the logic requires
              // checking only if the result set is greater than 0
              new QueryCommand({
                TableName: groupsTable,
                IndexName: 'groupName',
                KeyConditionExpression: '#groupname = :groupname',
                ExpressionAttributeNames: { '#groupname': 'groupName' },
                ExpressionAttributeValues: { ':groupname': groupName },
              }),
            );
            if (relatedGroups.Items.length !== 0) {
              ssoParams.PrincipalId = relatedGroups.Items[0].groupId;
              const messageParams = {
                ssoParams,
                actionType: action,
                entityType,
                tagKeyLookUp: tagKeyLookupValue,
              };
              params.Message = JSON.stringify(messageParams);
              await snsClientObject.send(new PublishCommand(params));
              console.log(
                `Processed provisioning of links as there are related links for ${entityData} of type ${entityType} found`,
              );
            } else if (adUsed === 'true' && domainName !== '') {
              // Handling AD sync as the group does not yet exist within DDB

              const listGroupsResult = await identityStoreClientObject.send(
                new ListGroupsCommand({
                  IdentityStoreId: identityStoreId,
                  Filters: [
                    {
                      AttributePath: 'DisplayName',
                      AttributeValue: `${groupName}@${domainName}`,
                    },
                  ],
                }),
              );

              if (listGroupsResult.Groups.length !== 0) {
                // Resolved the AD group ID and proceeding with the operation

                const groupId = listGroupsResult.Groups[0].GroupId;
                await ddbDocClientObject.send(
                  new PutCommand({
                    TableName: groupsTable,
                    Item: {
                      groupName,
                      groupId,
                    },
                  }),
                );

                ssoParams.PrincipalId = groupId;
                const messageParams = {
                  ssoParams,
                  actionType: action,
                  entityType,
                  tagKeyLookUp: tagKeyLookupValue,
                };
                params.Message = JSON.stringify(messageParams);
                await snsClientObject.send(
                  new PublishCommand(params).promise(),
                );
                console.log(
                  `Processed provisioning of links as there are related links for ${entityData} of type ${entityType} found`,
                );
              } else {
                // No related groups found from AD sync for this link
                console.log(
                  `Ignoring org event for ${entityData} of type ${entityType} as related groups are not found`,
                );
              }
            } else {
              // Either the permissionset or the group
              // pertaining to the link have not been provisioned yet
              console.log(
                `Ignoring org event for ${entityData} of type ${entityType} as related groups or permission set are not found`,
              );
            }
          }
        }),
      );
    } else if (entityType === 'account_tag') {
      // We need to determine if an account tag has been
      // updated to trigger de-provisioning logic
      console.log(
        `In orgevents, conducting de-provsioning check for entityData ${entityData} on targetaccount ID ${ssoParams.TargetId} as an account tag is now updated`,
      );
      await processAccountDeProvisioning(
        entityData.split('^')[0],
        params,
        ssoParams,
      );
    } else {
      // No related links for the org event being processed
    }
  } catch (err) {
    console.error(`Error Processing Notifications for org events ${err}`);
  }
};

exports.handler = async (event) => {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const params = {
      TopicArn: topicArn,
    };
    let entityData = '';
    let oldEntityData = '';

    const resolvedInstances = await ssoAdminClientObject.send(
      new ListInstancesCommand({}),
    );
    const instanceArn = resolvedInstances.Instances[0].InstanceArn;
    const identityStoreId = resolvedInstances.Instances[0].IdentityStoreId;
    const ssoParams = {
      InstanceArn: instanceArn,
      TargetType: 'AWS_ACCOUNT',
      PrincipalType: 'GROUP',
    };
    if (message.detail.eventName === 'CreateAccountResult') {
      ssoParams.TargetId = message.detail.serviceEventDetails.createAccountStatus.accountId;
      entityData = 'all';
      await processNotifications(
        'create',
        params,
        ssoParams,
        entityData,
        'root',
        identityStoreId,
      );
    } else if (message.detail.eventName === 'MoveAccount') {
      ssoParams.TargetId = message.detail.requestParameters.accountId;
      oldEntityData = message.detail.requestParameters.sourceParentId;
      entityData = message.detail.requestParameters.destinationParentId;
      await processNotifications(
        'delete',
        params,
        ssoParams,
        oldEntityData,
        'ou_id',
        identityStoreId,
      );
      await processNotifications(
        'create',
        params,
        ssoParams,
        entityData,
        'ou_id',
        identityStoreId,
      );
    } else if (message['detail-type'] === 'Tag Change on Resource') {
      console.log('In org events, received tag change on account');
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
      // eslint-disable-next-line prefer-destructuring
      ssoParams.TargetId = resources[0].split('/')[2];
      const changedTagKeys = detail['changed-tag-keys'];
      await Promise.all(
        changedTagKeys.map(async (changedTagKey) => {
          if (!Object.prototype.hasOwnProperty.call(tags, changedTagKey)) {
            // Account tag has been deleted
            console.log(
              `Determined that the tag change delta for ${changedTagKey} is a delete operation`,
            );
            await processAccountDeProvisioning(
              changedTagKey,
              params,
              ssoParams,
            );
          } else if (
            Object.prototype.hasOwnProperty.call(tags, changedTagKey)
          ) {
            // Account tag is either created/updated
            console.log(
              `Determined that the tag change delta for ${changedTagKey} is a create/update operation`,
            );
            await processNotifications(
              'create',
              params,
              ssoParams,
              `${changedTagKey}^${tags[changedTagKey]}`,
              'account_tag',
              identityStoreId,
            );
          }
        }),
      );
    }
  } catch (err) {
    console.error('Main handler exception in orgEvents', err);
    errorMessage.event_detail = event;
    errorMessage.error_details = err;
    errorParams.Message = JSON.stringify(errorMessage);
    await snsClientObject.send(new PublishCommand(errorParams));
  }
};

/*
Objective: Implement permission set sync
Trigger source: Permission set sync notification
                which in turn is triggered by permission
                set stream handler when it determines that
                there is a permission set being created/updated
                that has not yet been provisioned
- assumes role in SSO account for calling SSO admin API
- fetches if there are links provisioned already
  for the permission set in the links table
    - if the links are already provisioned,
      then determine whether the group is
      already provisioned
        - if the group is provisioned,
          determine the entity type
          - resolve the actual accounts
            if entity type is root , account_tag or ou_id
          - post the link operation messages
            to link manager topic
        - if the group is not yet provisioned,
           determine if AD config is being used
           and resolve the just-in-time group ID
           - Resolve the actual accounts and post
             the link operation messages to link
             manager topic
        - if AD config is not being used, then stop
          the process here
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

const {
  linksTableName,
  linkManagerTopicArn,
  groupsTableName,
  adUsed,
  domainName,
  SSOAPIRoleArn,
  ISAPIRoleArn,
  processTargetAccountSMInvokeRoleArn,
  processTargetAccountSMTopicArn,
  processTargetAccountSMArn,
  errorNotificationsTopicArn,
  ssoRegion,
  AWS_REGION,
} = process.env;

// SDK and third party client imports
const { fromTemporaryCredentials } = require('@aws-sdk/credential-providers');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');
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
const sfnClientObject = new SFNClient({
  region: 'us-east-1',
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: processTargetAccountSMInvokeRoleArn,
    },
  }),
});

const linkManagerTopicParams = {
  TopicArn: linkManagerTopicArn,
};
const errorParams = {
  TopicArn: errorNotificationsTopicArn,
};
const errorMessage = {};
errorMessage.Subject = 'Error Processing Permission set sync operation';

const invokeStepFunction = async (passedParams) => {
  const stepFunctionInput = {
    entityType: passedParams.entityType,
    action: passedParams.action,
    topicArn: processTargetAccountSMTopicArn,
    instanceArn: passedParams.instanceArn,
    targetType: 'AWS_ACCOUNT',
    principalType: 'GROUP',
    permissionSetArn: passedParams.permissionSetArn,
    principalId: passedParams.principalId,
    ou_id: passedParams.ou_id,
    resourceTypeFilters: passedParams.resourceTypeFilters,
    tagKey: passedParams.tagKey,
    tagValues: passedParams.tagValues,
    emptyString: '',
  };

  await sfnClientObject.send(
    new StartExecutionCommand({
      stateMachineArn: processTargetAccountSMArn,
      input: JSON.stringify(stepFunctionInput),
    }),
  );
  console.log(
    `In permissionSetSync, successfully triggered state machine for payload: ${JSON.stringify(
      stepFunctionInput,
    )}`,
  );
};

exports.handler = async (event) => {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const permissionSetName = message.permission_set_name;
    const permissionSetArn = message.permission_set_arn;
    const action = 'create';
    const relatedLinks = await ddbDocClientObject.send(
      // QueryCommand is a pagniated call, however the logic requires
      // checking only if the result set is greater than 0
      new QueryCommand({
        TableName: linksTableName,
        IndexName: 'permissionSetName',
        KeyConditionExpression: '#permissionSetName = :permissionSetName',
        ExpressionAttributeNames: { '#permissionSetName': 'permissionSetName' },
        ExpressionAttributeValues: { ':permissionSetName': permissionSetName },
      }),
    );

    if (relatedLinks.Items.length !== 0) {
      const resolvedInstances = await ssoAdminClientObject.send(
        new ListInstancesCommand({}),
      );
      const instanceArn = resolvedInstances.Instances[0].InstanceArn;

      const ssoParams = {
        InstanceArn: instanceArn,
        TargetType: 'AWS_ACCOUNT',
        PrincipalType: 'GROUP',
        PrincipalId: '',
        TargetId: '',
        PermissionSetArn: '',
      };
      await Promise.all(
        relatedLinks.Items.map(async (Item) => {
          ssoParams.PermissionSetArn = permissionSetArn;
          const { groupName } = Item;
          const entityType = Item.awsEntityType;
          const entityValue = Item.awsEntityData;
          const relatedGroups = await ddbDocClientObject.send(
            // QueryCommand is a pagniated call, however the logic requires
            // checking only if the result set is greater than 0
            new QueryCommand({
              TableName: groupsTableName,
              IndexName: 'groupName',
              KeyConditionExpression: '#groupname = :groupname',
              ExpressionAttributeNames: { '#groupname': 'groupName' },
              ExpressionAttributeValues: { ':groupname': groupName },
            }),
          );
          if (relatedGroups.Items.length !== 0) {
            ssoParams.PrincipalId = relatedGroups.Items[0].groupId;
            if (entityType === 'account') {
              ssoParams.TargetId = entityValue;
              const linkManagerMessageParams = {
                ssoParams,
                actionType: action,
                entityType,
                tagKeyLookUp: 'none',
              };
              linkManagerTopicParams.Message = JSON.stringify(
                linkManagerMessageParams,
              );
              await snsClientObject.send(
                new PublishCommand(linkManagerTopicParams),
              );
              console.log(
                `In permissionSetSync, successfully posted to linkmanager topic with params: ${JSON.stringify(
                  linkManagerMessageParams,
                )}`,
              );
            } else if (
              entityType === 'ou_id'
              || entityType === 'root'
              || entityType === 'account_tag'
            ) {
              const paramsToPass = {
                entityType,
                action,
                instanceArn: ssoParams.InstanceArn,
                permissionSetArn,
                principalId: ssoParams.PrincipalId,
                ou_id: '',
                resourceTypeFilters: 'organizations:account',
                tagKey: '',
                tagValues: '',
              };

              if (entityType === 'ou_id') {
                paramsToPass.ou_id = entityValue;
              }

              if (entityType === 'account_tag') {
                // eslint-disable-next-line prefer-destructuring
                paramsToPass.tagKey = entityValue.split('^')[0];
                // eslint-disable-next-line prefer-destructuring
                paramsToPass.tagValues = entityValue.split('^')[1];
              }

              await invokeStepFunction(paramsToPass);
            }
          } else if (adUsed === 'true' && domainName !== '') {
            // Handling AD sync as the group does not yet exist within DDB

            const identityStoreId = resolvedInstances.Instances[0].IdentityStoreId;
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
                  TableName: groupsTableName,
                  Item: {
                    groupName,
                    groupId,
                  },
                }),
              );

              ssoParams.PrincipalId = groupId;
              if (entityType === 'account') {
                ssoParams.TargetId = entityValue;
                const linkManagerMessageParams = {
                  ssoParams,
                  actionType: action,
                  entityType,
                  tagKeyLookUp: 'none',
                };
                linkManagerTopicParams.Message = JSON.stringify(
                  linkManagerMessageParams,
                );
                await snsClientObject.send(
                  new PublishCommand(linkManagerTopicParams),
                );
                console.log(
                  `In permissionSetSync, successfully posted to linkmanager topic with params: ${JSON.stringify(
                    linkManagerMessageParams,
                  )}`,
                );
              } else if (
                entityType === 'ou_id'
                || entityType === 'root'
                || entityType === 'account_tag'
              ) {
                const paramsToPass = {
                  entityType,
                  action,
                  instanceArn: ssoParams.InstanceArn,
                  permissionSetArn,
                  principalId: ssoParams.PrincipalId,
                  ou_id: '',
                  resourceTypeFilters: 'organizations:account',
                  tagKey: '',
                  tagValues: '',
                };

                if (entityType === 'ou_id') {
                  paramsToPass.ou_id = entityValue;
                }

                if (entityType === 'account_tag') {
                  // eslint-disable-next-line prefer-destructuring
                  paramsToPass.tagKey = entityValue.split('^')[0];
                  // eslint-disable-next-line prefer-destructuring
                  paramsToPass.tagValues = entityValue.split('^')[1];
                }

                await invokeStepFunction(paramsToPass);
              }
            } else {
              // No related groups found from AD sync for this link
            }
          } else {
            // Ignoring permission set sync for the link as the group is not yet provisioned
          }
        }),
      );
    } else {
      // Ignoring permission set sync as there are no
      // related links already provisioined for this permission set
    }
  } catch (err) {
    console.error('Main exception handler in permissionSetSync: ', err);
    errorMessage.event_detail = event;
    errorMessage.error_details = err;
    errorParams.Message = JSON.stringify(errorMessage);
    await snsClientObject.send(new PublishCommand(errorParams));
  }
};

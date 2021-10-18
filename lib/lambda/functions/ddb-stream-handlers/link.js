/*
Objective: Implement link table DDB changes for link processing functionality
Trigger source: links DDB table stream notifications for NEW_AND_OLD_IMAGES
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
  topicArn,
  adUsed,
  domainName,
  errorNotificationsTopicArn,
  ssoRegion,
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
const sfnClientObject = new SFNClient({
  region: 'us-east-1',
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

// Error topic initialisation
const errorParams = {
  TopicArn: errorNotificationsTopicArn,
};
const errorMessage = {};
errorMessage.Subject = 'Error Processing Link DDB table stream records';

// Inovke step function utility function
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
};

exports.handler = async (event) => {
  try {
    const params = {
      TopicArn: topicArn,
      Message: '',
    };

    // Instance Arn needed for SSO admin API's
    const resolvedInstances = await ssoAdminClientObject.send(
      new ListInstancesCommand({}),
    );
    const instanceArn = resolvedInstances.Instances[0].InstanceArn;

    // Identity store ID needed for SSO Identity Store API's
    const identityStoreId = resolvedInstances.Instances[0].IdentityStoreId;

    // Because it's a stream handler, there
    // could be more than one link updates coming through, hence the proimse all
    await Promise.all(
      event.Records.map(async (record) => {
        // ssoParams is the topic body construct that
        // gets passed to the actual link provisioning
        // (createAccountAssignment
        // and deleteAccountAssignment SSO admin
        // API operations) handler in sso-handlers/linkManager.js
        const ssoParams = {
          InstanceArn: instanceArn,
          TargetType: 'AWS_ACCOUNT',
          PrincipalType: 'GROUP',
          PrincipalId: '',
          TargetId: '',
          PermissionSetArn: '',
        };

        // Deconstruct and get the values for the SSO Admin API operations
        const delimeter = '.';
        const linkKeyArray = record.dynamodb.Keys.awsEntityId.S.split(delimeter);
        const entityType = linkKeyArray[0];
        const entityValue = linkKeyArray[1];
        const permissionsetName = linkKeyArray[2];
        const groupName = linkKeyArray.slice(3, -1).join(delimeter);
        let action = '';
        if (record.eventName === 'INSERT') {
          action = 'create';
        } else if (record.eventName === 'REMOVE') {
          action = 'delete';
        }

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

        const permissionSetRecord = await ddbDocClientObject.send(
          new GetCommand({
            TableName: permissionSetArnTable,
            Key: {
              permissionSetName: permissionsetName,
            },
          }),
        );
        if (permissionSetRecord.Item) {
          const { permissionSetArn } = permissionSetRecord.Item;
          console.log(
            `In link stream handler, found related permission sets for the permission set arn: ${permissionSetArn}`,
          );
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
            console.log(
              `In link stream handler, found related groups: ${relatedGroups.Items[0].groupId}`,
            );
            if (entityType === 'account') {
              ssoParams.TargetId = entityValue;
              ssoParams.PermissionSetArn = permissionSetArn;
              const messageParams = {
                ssoParams,
                actionType: action,
                entityType,
                tagKeyLookUp: 'none',
              };
              params.Message = JSON.stringify(messageParams);
              await snsClientObject.send(new PublishCommand(params));
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
            // Handling AD sync as the group does not yet exist within DDB',
            console.log(
              `In link stream handler, resolving SSO generated group ID for group: ${groupName}@${domainName}`,
            );
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
              const groupId = listGroupsResult.Groups[0].GroupId;
              console.log(
                `In link stream handler resolved group ID: ${listGroupsResult.Groups[0].GroupId}`,
              );
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

              if (entityType === 'account') {
                ssoParams.TargetId = entityValue;
                ssoParams.PermissionSetArn = permissionSetArn;
                const messageParams = {
                  ssoParams,
                  actionType: action,
                  entityType,
                  tagKeyLookUp: 'none',
                };
                params.Message = JSON.stringify(messageParams);
                await snsClientObject.send(new PublishCommand(params));
              } else if (
                entityType === 'ou_id'
                || entityType === 'root'
                || entityType === 'account_tag'
              ) {
                const paramsToPass = {
                  entityType,
                  action,
                  instanceArn: ssoParams.InstanceArn,
                  permissionSetArn: ssoParams.PermissionSetArn,
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
            // No related groups found for this link
          }
        } else {
          // Permission set does not exist
        }
      }),
    );
    return 'Successfully processed all records in the current stream shard';
  } catch (err) {
    console.error('main handler exception in link stream handler: ', err);
    errorMessage.event_detail = event;
    errorMessage.error_details = err;
    errorParams.Message = JSON.stringify(errorMessage);
    await snsClientObject.send(new PublishCommand(errorParams));
    return err;
  }
};

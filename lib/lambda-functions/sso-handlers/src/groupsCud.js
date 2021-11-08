/*
Objective: Implement SSO group events handler for processing groups
Trigger source: SSO group changes notification topic which in turn
                receives event bridge notifications from SSO account
                for group changes
- assumes role in SSO account for calling SSO admin API - listInstances
- determine if the event type is create or delete
- determine the group name (SSO uses
      different event schemas for this
      event depending on the identity store)
- if create/delete
  - upsert/delete into groups DDB table
  - determine if there are related links
    already provisioned by looking up
    links table
  - if there are related links, then
    - for each related link
    - determine if permission set referenced
      in the link is already provisioned by
      looking up permissionsetArn ddb table
        - if permission set is already
          provisioned, then
            - determine if the link type is
              account, ou_id, account_tag or root
            - if account, post the link
              operation details to link manager
              topic
            - if ou_id, root, account_tag resolve the
              actual accounts and post the link
              operation details to the link manager
              topic, one message per account
        - if permission set is not provisioned,
          stop the operation here
    - if there are no related links, then
      stop the operation here
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

// Environment configuration read
const {
  SSOAPIRoleArn,
  DdbTable,
  processTargetAccountSMInvokeRoleArn,
  processTargetAccountSMTopicArn,
  processTargetAccountSMArn,
  permissionarntable,
  linkstable,
  topicArn,
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
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { SFNClient, StartExecutionCommand } = require('@aws-sdk/client-sfn');
const {
  SSOAdminClient,
  ListInstancesCommand,
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
const sfnClientObject = new SFNClient({
  region: 'us-east-1',
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: processTargetAccountSMInvokeRoleArn,
    },
  }),
});

const errorParams = {
  TopicArn: errorNotificationsTopicArn,
};
const errorMessage = {};
errorMessage.Subject = 'Error Processing group trigger based link provisioning operation';

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
    const message = JSON.parse(event.Records[0].Sns.Message);
    const params = {
      TopicArn: topicArn,
      Message: '',
    };
    let groupId = '';
    let groupName = '';
    let action = '';

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
    if (message.detail.eventName === 'CreateGroup') {
      action = 'create';
      groupId = message.detail.responseElements.group.groupId;
      // To handle SSO generating cloudwatch events with different formats
      // depending on the identity store being used
      if (
        Object.prototype.hasOwnProperty.call(
          message.detail.responseElements.group,
          'displayName',
        )
      ) {
        groupName = message.detail.responseElements.group.displayName;
      } else if (
        Object.prototype.hasOwnProperty.call(
          message.detail.responseElements.group,
          'groupName',
        )
      ) {
        groupName = message.detail.responseElements.group.groupName;
      }

      await ddbDocClientObject.send(
        new PutCommand({
          TableName: DdbTable,
          Item: {
            groupName,
            groupId,
          },
        }),
      );
      ssoParams.PrincipalId = groupId;
      console.log(
        `In ssogroups handler, resolved groupName as ${groupName} and processed DDB table upsert`,
      );
      const realtedLinks = await ddbDocClientObject.send(
        // QueryCommand is a pagniated call, however the logic requires
        // checking only if the result set is greater than 0
        new QueryCommand({
          TableName: linkstable,
          IndexName: 'groupName',
          KeyConditionExpression: '#groupname = :groupname',
          ExpressionAttributeNames: { '#groupname': 'groupName' },
          ExpressionAttributeValues: { ':groupname': groupName },
        }),
      );
      if (realtedLinks.Items.length !== 0) {
        await Promise.all(
          realtedLinks.Items.map(async (Item) => {
            const entityType = Item.awsEntityType;
            const entityValue = Item.awsEntityData;
            const { permissionSetName } = Item;
            const permissionSetFetch = await ddbDocClientObject.send(
              new GetCommand({
                TableName: permissionarntable,
                Key: {
                  permissionSetName,
                },
              }),
            );
            if (permissionSetFetch.Item) {
              const { permissionSetArn } = permissionSetFetch.Item;
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
            } else {
              // Permission set for the group-link does not exist
            }
          }),
        );
        console.log(
          `In ssogroups handler, related links found for groupName ${groupName}`,
        );
      } else {
        // No related links for the group being processed
      }
    } else if (message.detail.eventName === 'DeleteGroup') {
      action = 'delete';
      groupId = message.detail.requestParameters.groupId;
      const groupFetch = await ddbDocClientObject.send(
        new GetCommand({
          TableName: DdbTable,
          Key: {
            groupId,
          },
        }),
      );
      if (groupFetch.Item) {
        groupName = groupFetch.Item.groupName;
        const realtedLinks = await ddbDocClientObject.send(
          // QueryCommand is a pagniated call, however the logic requires
          // checking only if the result set is greater than 0
          new QueryCommand({
            TableName: linkstable,
            IndexName: 'groupName',
            KeyConditionExpression: '#groupname = :groupname',
            ExpressionAttributeNames: { '#groupname': 'groupName' },
            ExpressionAttributeValues: { ':groupname': groupName },
          }),
        );
        if (realtedLinks.Items.length !== 0) {
          // Received groupDelete where the group has existing links.
          // These links would become orphaned and not accessbile anymore,
          // therefore deleting them
          await Promise.all(
            realtedLinks.Items.map(async (Item) => {
              await ddbDocClientObject.send(
                new DeleteCommand({
                  TableName: linkstable,
                  Key: {
                    awsEntityId: Item.awsEntityId,
                  },
                }),
              );
            }),
          );
          console.log(
            `In ssogroups handler, resolved groupName as ${groupName} and processed DDB table deletion`,
          );
        } else {
          // No related links for the group being deleted
        }
        await ddbDocClientObject.send(
          new DeleteCommand({
            TableName: DdbTable,
            Key: {
              groupId,
            },
          }),
        );
      } else {
        // The group does not exist, so not deleting again
      }
    }
  } catch (err) {
    console.error('Main handler exception in groupsCud: ', err);
    errorMessage.event_detail = event;
    errorMessage.error_details = err;
    errorParams.Message = JSON.stringify(errorMessage);
    await snsClientObject.send(new PublishCommand(errorParams));
  }
};

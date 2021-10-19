/*
Objective: Implement permission set CRUD operations
Trigger source: permission set topic notifications
- assumes role in SSO account for calling SSO admin API
- if operation type is insert
  - read complete permission set object from
    ddb table
  - create permission set object with the params
    set for session duration, name, relay state
    and description
  - upsert into permissionsetArn table with the
    value received from above
  - apply tags to permission set if they exist
  - apply managed policies to permission set if they
    exit
  - if inline policy exists, attach the inline
    policy to the permission set
- if operation type is modify
  - determine if the delta is any of the following:
    managed policies
    inline policy
    session duration
    relay state
    tags
  - process update permission set if any of the above
    fields are changed
  - if the changes include managed policy or inline
    policy changes, trigger a reprovisioning operation
    as well and post the request id to waiter handler
- if operation type is delete
  - delete the permission set first
  - then delete the permission set arn entry as well
- if operation type is create/delete, post permission set
  name, permission set arn, reprovision status to permission
  set sync topic
- Catch all failures in a generic exception block
  and post the error details to error notifications topics
*/

const {
  SSOAPIRoleArn,
  DdbTable,
  Arntable,
  errorNotificationsTopicArn,
  permissionSetSyncTopicArn,
  waiterTopicArn,
  ssoRegion,
  AWS_REGION,
} = process.env;

// SDK and third party client imports
const { fromTemporaryCredentials } = require('@aws-sdk/credential-providers');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  GetCommand,
  UpdateCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const {
  SSOAdminClient,
  ListInstancesCommand,
  CreatePermissionSetCommand,
  TagResourceCommand,
  AttachManagedPolicyToPermissionSetCommand,
  PutInlinePolicyToPermissionSetCommand,
  DetachManagedPolicyFromPermissionSetCommand,
  UntagResourceCommand,
  UpdatePermissionSetCommand,
  ListAccountsForProvisionedPermissionSetCommand,
  DeletePermissionSetCommand,
  ProvisionPermissionSetCommand,
  DeleteInlinePolicyFromPermissionSetCommand,
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

const errorParams = {
  TopicArn: errorNotificationsTopicArn,
};
const permissionSetSyncParams = {
  TopicArn: permissionSetSyncTopicArn,
};
const permissionSetSyncMessage = {};
let syncPermissionSet = false;
const errorMessage = {};
errorMessage.Subject = 'Error Processing Permission Set Provisioning operation';

const waiterParams = {
  TopicArn: waiterTopicArn,
};
const waiterMessage = {};

function MinutesToISO8601Duration(minutes) {
  let s = minutes;
  const days = Math.floor(s / 1440);
  s -= days * 1440;
  const hours = Math.floor(s / 60);
  s -= hours * 60;
  let dur = 'PT';
  if (days > 0) {
    dur += `${days}D`;
  }
  if (hours > 0) {
    dur += `${hours}H`;
  }
  dur += `${s}M`;
  return dur;
}
exports.handler = async (event) => {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const permissionSetName = message.record.dynamodb.Keys.permissionSetName.S;
    permissionSetSyncMessage.permission_set_name = permissionSetName;

    const resolvedInstances = await ssoAdminClientObject.send(
      new ListInstancesCommand({}),
    );
    const instanceArn = resolvedInstances.Instances[0].InstanceArn;

    waiterMessage.waiter_name = 'PermissionSetProvisioned';
    waiterMessage.instance_arn = instanceArn;
    if (message.event_type === 'INSERT') {
      const currentItem = await ddbDocClientObject.send(
        new GetCommand({
          TableName: DdbTable,
          Key: {
            permissionSetName,
          },
        }),
      );

      const createParams = {
        InstanceArn: instanceArn,
        SessionDuration: MinutesToISO8601Duration(
          message.record.dynamodb.NewImage.sessionDurationInMinutes.S,
        ),
        RelayState: message.record.dynamodb.NewImage.relayState.S,
        Name: permissionSetName,
        Description: permissionSetName,
      };
      const createOp = await ssoAdminClientObject.send(
        new CreatePermissionSetCommand(createParams),
      );
      console.log(
        `In permissionsettopic handler, created permission set ${permissionSetName}`,
      );
      const permissionSetArn = createOp.PermissionSet.PermissionSetArn;

      await ddbDocClientObject.send(
        new UpdateCommand({
          TableName: Arntable,
          Key: {
            permissionSetName,
          },
          UpdateExpression: 'set permissionSetArn=:arnvalue',
          ExpressionAttributeValues: {
            ':arnvalue': permissionSetArn.toString(),
          },
        }),
      );
      console.log(
        `In permissionsettopic handler, set arn value for permission set ${permissionSetName}`,
      );
      if (currentItem.Item.tags.length !== 0) {
        await ssoAdminClientObject.send(
          new TagResourceCommand({
            InstanceArn: instanceArn,
            ResourceArn: permissionSetArn,
            Tags: currentItem.Item.tags,
          }),
        );
        console.log(
          `In permissionsettopic handler, update tags for permission set ${permissionSetName}`,
        );
      }

      if (currentItem.Item.managedPoliciesArnList.length !== 0) {
        await Promise.all(
          currentItem.Item.managedPoliciesArnList.map(
            async (manaagedPolicyArn) => {
              await ssoAdminClientObject.send(
                new AttachManagedPolicyToPermissionSetCommand({
                  InstanceArn: instanceArn,
                  PermissionSetArn: permissionSetArn,
                  ManagedPolicyArn: manaagedPolicyArn,
                }),
              );
            },
          ),
        );
        console.log(
          `In permissionsettopic handler, processed all managed policies for permission set ${permissionSetName}`,
        );
      }
      if ('inlinePolicyDocument' in currentItem.Item) {
        if (Object.keys(currentItem.Item.inlinePolicyDocument).length !== 0) {
          await ssoAdminClientObject.send(
            new PutInlinePolicyToPermissionSetCommand({
              InstanceArn: instanceArn,
              InlinePolicy: JSON.stringify(
                currentItem.Item.inlinePolicyDocument,
              ),
              PermissionSetArn: permissionSetArn,
            }),
          );
          console.log(
            `In permissionsettopic handler, processed inline policy for permission set ${permissionSetName}`,
          );
        }
      }
      permissionSetSyncMessage.permission_set_arn = permissionSetArn;
      syncPermissionSet = true;
    } else if (message.event_type === 'MODIFY') {
      if (message.diff.diffList.length !== 0) {
        const fetchArn = await ddbDocClientObject.send(
          new GetCommand({
            TableName: Arntable,
            Key: {
              permissionSetName,
            },
          }),
        );
        const currentpermissionSet = await ddbDocClientObject.send(
          new GetCommand({
            TableName: DdbTable,
            Key: {
              permissionSetName,
            },
          }),
        );

        let currentInlinePolicy = '';
        let currentSessionDuration = '';
        let currentRelayState = '';
        let currentTags = '';
        let reProvision = false;
        let inlinePolicyContentChange = false;
        let updatePermissionSetAttributes = false;
        let updateTags = false;

        if (currentpermissionSet.Item.inlinePolicyDocument.length !== 0) {
          currentInlinePolicy = currentpermissionSet.Item.inlinePolicyDocument;
        }
        if (currentpermissionSet.Item.sessionDurationInMinutes.length !== 0) {
          currentSessionDuration = currentpermissionSet.Item.sessionDurationInMinutes;
        }
        if (currentpermissionSet.Item.relayState.length !== 0) {
          currentRelayState = currentpermissionSet.Item.relayState;
        }
        if (currentpermissionSet.Item.tags.length !== 0) {
          currentTags = currentpermissionSet.Item.tags;
        }

        const { permissionSetArn } = fetchArn.Item;

        await Promise.all(
          message.diff.diffList.map(async (item) => {
            if (
              item.path.toString().includes('managedPoliciesArnList')
              && item.diff === 'deleted'
            ) {
              // managedpolicies-deleted
              await ssoAdminClientObject.send(
                new DetachManagedPolicyFromPermissionSetCommand({
                  InstanceArn: instanceArn,
                  PermissionSetArn: permissionSetArn,
                  ManagedPolicyArn: item.oldVal,
                }),
              );
              console.log(
                `In permissionsettopic handler, processed managed policies-delete for permission set ${permissionSetName}`,
              );
              reProvision = true;
            } else if (
              item.path.toString().includes('managedPoliciesArnList')
              && item.diff === 'created'
            ) {
              // managedpolicies-created
              await ssoAdminClientObject.send(
                new AttachManagedPolicyToPermissionSetCommand({
                  InstanceArn: instanceArn,
                  PermissionSetArn: permissionSetArn,
                  ManagedPolicyArn: item.newVal,
                }),
              );
              console.log(
                `In permissionsettopic handler, processed managed policies-create for permission set ${permissionSetName}`,
              );
              reProvision = true;
            } else if (
              item.path.toString().includes('managedPoliciesArnList')
              && item.diff === 'updated'
            ) {
              // managedpolicies-updated-removing old value
              await ssoAdminClientObject.send(
                new DetachManagedPolicyFromPermissionSetCommand({
                  InstanceArn: instanceArn,
                  PermissionSetArn: permissionSetArn,
                  ManagedPolicyArn: item.oldVal,
                }),
              );
              console.log(
                `In permissionsettopic handler, processed managed policies-update-remove-old-value for permission set ${permissionSetName}`,
              );
              // managedpolicies-updated-adding new value
              await ssoAdminClientObject.send(
                new AttachManagedPolicyToPermissionSetCommand({
                  InstanceArn: instanceArn,
                  PermissionSetArn: permissionSetArn,
                  ManagedPolicyArn: item.newVal,
                }),
              );
              console.log(
                `In permissionsettopic handler, processed managed policies-update-add-new-value for permission set ${permissionSetName}`,
              );
              reProvision = true;
            } else if (
              ((item.path.toString() === 'inlinePolicyDocument.Version'
                || item.path.toString() === 'inlinePolicyDocument.Statement')
                && (item.diff === 'updated' || item.diff === 'created'))
              || (item.path.toString().includes('inlinePolicyDocument')
                && (item.diff === 'updated'
                  || item.diff === 'created'
                  || item.diff === 'deleted'))
            ) {
              // inline-version-or-statement updated or created
              // or
              // // inline-content changed
              inlinePolicyContentChange = true;
              reProvision = true;
            } else if (
              (item.path.toString() === 'inlinePolicyDocument.Version'
                || item.path.toString() === 'inlinePolicyDocument.Statement')
              && item.diff === 'deleted'
            ) {
              // inline-deleted
              await ssoAdminClientObject.send(
                new DeleteInlinePolicyFromPermissionSetCommand({
                  InstanceArn: instanceArn,
                  PermissionSetArn: permissionSetArn,
                }),
              );
              console.log(
                `In permissionsettopic handler, delete current inline policy for permission set ${permissionSetName}`,
              );
              reProvision = true;
            } else if (
              item.path.toString() === 'sessionDurationInMinutes'
              && (item.diff === 'updated' || item.diff === 'created')
            ) {
              // sessionduraitoninminutes - created or updated
              updatePermissionSetAttributes = true;
            } else if (
              item.path.toString() === 'relayState'
              && (item.diff === 'updated' || item.diff === 'created')
            ) {
              // relayState - created or updated
              updatePermissionSetAttributes = true;
            } else if (
              /tags.\d$/gm.test(item.path.toString())
              && item.diff === 'created'
            ) {
              // adding a new tag
              await ssoAdminClientObject.send(
                new TagResourceCommand({
                  InstanceArn: instanceArn,
                  ResourceArn: permissionSetArn,
                  Tags: [
                    {
                      Key: item.newVal.Key,
                      Value: item.newVal.Value,
                    },
                  ],
                }),
              );
              console.log(
                `In permissionsettopic handler, add new tag for permission set ${permissionSetName}`,
              );
            } else if (
              /tags.\d$/gm.test(item.path.toString())
              && item.diff === 'deleted'
            ) {
              // removing an existing tag
              await ssoAdminClientObject.send(
                new UntagResourceCommand({
                  InstanceArn: instanceArn,
                  ResourceArn: permissionSetArn,
                  TagKeys: [item.oldVal.Key],
                }),
              );
              console.log(
                `In permissionsettopic handler, remove existing tag for permission set ${permissionSetName}`,
              );
            } else if (/tags.\d.[A-Za-z]*$/gm.test(item.path.toString())) {
              // Detected update of a tag key or value
              updateTags = true;
            }
          }),
        );

        if (inlinePolicyContentChange) {
          // Processing Inline poilcy updates
          await ssoAdminClientObject.send(
            new PutInlinePolicyToPermissionSetCommand({
              InstanceArn: instanceArn,
              PermissionSetArn: permissionSetArn,
              InlinePolicy: JSON.stringify(currentInlinePolicy),
            }),
          );
          console.log(
            `In permissionsettopic handler, processed inline policy update for permission set ${permissionSetName}`,
          );
        }
        if (updatePermissionSetAttributes) {
          // Processing permission set attributes updates
          await ssoAdminClientObject.send(
            new UpdatePermissionSetCommand({
              PermissionSetArn: permissionSetArn,
              InstanceArn: instanceArn,
              SessionDuration: MinutesToISO8601Duration(currentSessionDuration),
              RelayState: currentRelayState,
            }),
          );
          console.log(
            `In permissionsettopic handler, processed attribute update for permission set ${permissionSetName}`,
          );
        }

        if (updateTags && currentTags.length !== 0) {
          // Processing Tag key or value updates
          await ssoAdminClientObject.send(
            new TagResourceCommand({
              InstanceArn: instanceArn,
              ResourceArn: permissionSetArn,
              Tags: currentTags,
            }),
          );
          console.log(
            `In permissionsettopic handler, processed tag updates for permission set ${permissionSetName}`,
          );
        }

        if (reProvision) {
          // Permission set had an update on managed policies or
          // inline policy content, so triggering re-provisioning
          // operation to ALL_PROVISIONED_ACCOUNTS

          // ListAccountsForProvisionedPermissionSetCommand is a paginated operation,
          // however won't paginate through the iterator as we are interested
          // if the result set is more than 0 only
          const fetchAccountsList = await ssoAdminClientObject.send(
            new ListAccountsForProvisionedPermissionSetCommand({
              InstanceArn: instanceArn,
              PermissionSetArn: permissionSetArn,
            }),
          );
          if (fetchAccountsList.length !== 0) {
            const reProvisionOp = await ssoAdminClientObject.send(
              new ProvisionPermissionSetCommand({
                InstanceArn: instanceArn,
                PermissionSetArn: permissionSetArn,
                TargetType: 'ALL_PROVISIONED_ACCOUNTS',
              }),
            );
            console.log(
              `In permissionsettopic handler, triggered re-provisioning for permission set ${permissionSetName} across ${fetchAccountsList.length} number of accounts`,
            );
            waiterMessage.request_id = reProvisionOp.PermissionSetProvisioningStatus.RequestId;
            waiterParams.Message = JSON.stringify(waiterMessage);
            await snsClientObject.send(new PublishCommand(waiterParams));
          }
        }

        if (!reProvision) {
          permissionSetSyncMessage.permission_set_arn = permissionSetArn;
          syncPermissionSet = true;
        }
      }
    } else if (message.event_type === 'REMOVE') {
      const currentItem = await ddbDocClientObject.send(
        new GetCommand({
          TableName: Arntable,
          Key: {
            permissionSetName,
          },
        }),
      );
      const { permissionSetArn } = currentItem.Item;
      await ssoAdminClientObject.send(
        new DeletePermissionSetCommand({
          InstanceArn: instanceArn,
          PermissionSetArn: permissionSetArn,
        }),
      );
      await ddbDocClientObject.send(
        new DeleteCommand({
          TableName: Arntable,
          Key: {
            permissionSetName,
          },
        }),
      );
      console.log(
        `In permissionsettopic handler, processed deletion for permission set ${permissionSetName}`,
      );
    }

    permissionSetSyncParams.Message = JSON.stringify(permissionSetSyncMessage);
    if (syncPermissionSet) {
      // triggering sync as permission set has been created/updated
      await snsClientObject.send(new PublishCommand(permissionSetSyncParams));
      console.log(
        `In permissionsettopic handler, triggering sync logic for permission set ${permissionSetName}`,
      );
    }
  } catch (err) {
    console.error('Main handler exception in permissionSetTopic: ', err);
    errorMessage.event_detail = event;
    errorMessage.error_details = err;
    errorParams.Message = JSON.stringify(errorMessage);
    await snsClientObject.send(new PublishCommand(errorParams));
  }
};

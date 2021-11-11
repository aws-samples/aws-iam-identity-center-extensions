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
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import {
  AttachManagedPolicyToPermissionSetCommand,
  CreatePermissionSetCommand,
  DeleteInlinePolicyFromPermissionSetCommand,
  DeletePermissionSetCommand,
  DetachManagedPolicyFromPermissionSetCommand,
  ListAccountsForProvisionedPermissionSetCommand,
  ListInstancesCommand,
  ListInstancesCommandOutput,
  ProvisionPermissionSetCommand,
  PutInlinePolicyToPermissionSetCommand,
  SSOAdminClient,
  Tag,
  TagResourceCommand,
  UntagResourceCommand,
  UpdatePermissionSetCommand,
} from "@aws-sdk/client-sso-admin";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  GetCommandOutput,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { SNSEvent } from "aws-lambda";
import { ErrorMessage } from "../../helpers/src/interfaces";
import { MinutesToISO8601Duration } from "../../helpers/src/utilities";

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

let syncPermissionSet = false;
//Error notification
const errorMessage: ErrorMessage = {
  Subject: "Error Processing Permission Set Provisioning operation",
};

export const handler = async (event: SNSEvent) => {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const permissionSetName = message.record.dynamodb.Keys.permissionSetName.S;
    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
    let permissionSetArn = "";
    if (message.event_type === "INSERT") {
      const currentItem: GetCommandOutput = await ddbDocClientObject.send(
        new GetCommand({
          TableName: DdbTable,
          Key: {
            permissionSetName,
          },
        })
      );

      const createOp = await ssoAdminClientObject.send(
        new CreatePermissionSetCommand({
          InstanceArn: instanceArn,
          Name: permissionSetName,
          Description: permissionSetName,
          RelayState: message.record.dynamodb.NewImage.relayState.S,
          SessionDuration: MinutesToISO8601Duration(
            parseInt(
              message.record.dynamodb.NewImage.sessionDurationInMinutes.S
            )
          ),
        })
      );
      console.log(
        `In permissionsettopic handler, created permission set ${permissionSetName}`
      );
      permissionSetArn =
        createOp.PermissionSet?.PermissionSetArn?.toString() + "";
      await ddbDocClientObject.send(
        new UpdateCommand({
          TableName: Arntable,
          Key: {
            permissionSetName,
          },
          UpdateExpression: "set permissionSetArn=:arnvalue",
          ExpressionAttributeValues: {
            ":arnvalue": createOp.PermissionSet?.PermissionSetArn?.toString(),
          },
        })
      );
      console.log(
        `In permissionsettopic handler, set arn value for permission set ${permissionSetName}`
      );
      if (currentItem.Item && currentItem.Item.tags.length !== 0) {
        await ssoAdminClientObject.send(
          new TagResourceCommand({
            InstanceArn: instanceArn,
            ResourceArn: createOp.PermissionSet?.PermissionSetArn?.toString(),
            Tags: currentItem.Item.tags,
          })
        );
        console.log(
          `In permissionsettopic handler, update tags for permission set ${permissionSetName}`
        );
      }
      if (
        currentItem.Item &&
        currentItem.Item.managedPoliciesArnList.length !== 0
      ) {
        await Promise.all(
          currentItem.Item.managedPoliciesArnList.map(
            async (manaagedPolicyArn: string) => {
              await ssoAdminClientObject.send(
                new AttachManagedPolicyToPermissionSetCommand({
                  InstanceArn: instanceArn,
                  PermissionSetArn:
                    createOp.PermissionSet?.PermissionSetArn?.toString(),
                  ManagedPolicyArn: manaagedPolicyArn,
                })
              );
            }
          )
        );
        console.log(
          `In permissionsettopic handler, processed all managed policies for permission set ${permissionSetName}`
        );
      }
      if (currentItem.Item && "inlinePolicyDocument" in currentItem.Item) {
        if (Object.keys(currentItem.Item.inlinePolicyDocument).length !== 0) {
          await ssoAdminClientObject.send(
            new PutInlinePolicyToPermissionSetCommand({
              InstanceArn: instanceArn,
              InlinePolicy: JSON.stringify(
                currentItem.Item.inlinePolicyDocument
              ),
              PermissionSetArn:
                createOp.PermissionSet?.PermissionSetArn?.toString(),
            })
          );
          console.log(
            `In permissionsettopic handler, processed inline policy for permission set ${permissionSetName}`
          );
        }
      }

      syncPermissionSet = true;
    } else if (message.event_type === "MODIFY") {
      if (message.diff.diffList.length !== 0) {
        const fetchArn: GetCommandOutput = await ddbDocClientObject.send(
          new GetCommand({
            TableName: Arntable,
            Key: {
              permissionSetName,
            },
          })
        );
        const currentpermissionSet: GetCommandOutput =
          await ddbDocClientObject.send(
            new GetCommand({
              TableName: DdbTable,
              Key: {
                permissionSetName,
              },
            })
          );

        let currentInlinePolicy = "";
        let currentSessionDuration = "";
        let currentRelayState = "";
        let currentTags: Array<Tag> = [];
        let reProvision = false;
        let inlinePolicyContentChange = false;
        let updatePermissionSetAttributes = false;
        let updateTags = false;

        if (currentpermissionSet.Item && fetchArn.Item) {
          if (currentpermissionSet.Item.inlinePolicyDocument.length !== 0) {
            currentInlinePolicy =
              currentpermissionSet.Item.inlinePolicyDocument;
          }
          if (currentpermissionSet.Item.sessionDurationInMinutes.length !== 0) {
            currentSessionDuration =
              currentpermissionSet.Item.sessionDurationInMinutes;
          }
          if (currentpermissionSet.Item.relayState.length !== 0) {
            currentRelayState = currentpermissionSet.Item.relayState;
          }
          if (currentpermissionSet.Item.tags.length !== 0) {
            currentTags = currentpermissionSet.Item.tags;
          }

          permissionSetArn = fetchArn.Item.permissionSetArn;

          await Promise.all(
            /* eslint-disable  @typescript-eslint/no-explicit-any */
            message.diff.diffList.map(async (item: any) => {
              if (
                item.path.toString().includes("managedPoliciesArnList") &&
                item.diff === "deleted"
              ) {
                // managedpolicies-deleted
                await ssoAdminClientObject.send(
                  new DetachManagedPolicyFromPermissionSetCommand({
                    InstanceArn: instanceArn,
                    PermissionSetArn: permissionSetArn,
                    ManagedPolicyArn: item.oldVal,
                  })
                );
                console.log(
                  `In permissionsettopic handler, processed managed policies-delete for permission set ${permissionSetName}`
                );
                reProvision = true;
              } else if (
                item.path.toString().includes("managedPoliciesArnList") &&
                item.diff === "created"
              ) {
                // managedpolicies-created
                await ssoAdminClientObject.send(
                  new AttachManagedPolicyToPermissionSetCommand({
                    InstanceArn: instanceArn,
                    PermissionSetArn: permissionSetArn,
                    ManagedPolicyArn: item.newVal,
                  })
                );
                console.log(
                  `In permissionsettopic handler, processed managed policies-create for permission set ${permissionSetName}`
                );
                reProvision = true;
              } else if (
                item.path.toString().includes("managedPoliciesArnList") &&
                item.diff === "updated"
              ) {
                // managedpolicies-updated-removing old value
                await ssoAdminClientObject.send(
                  new DetachManagedPolicyFromPermissionSetCommand({
                    InstanceArn: instanceArn,
                    PermissionSetArn: permissionSetArn,
                    ManagedPolicyArn: item.oldVal,
                  })
                );
                console.log(
                  `In permissionsettopic handler, processed managed policies-update-remove-old-value for permission set ${permissionSetName}`
                );
                // managedpolicies-updated-adding new value
                await ssoAdminClientObject.send(
                  new AttachManagedPolicyToPermissionSetCommand({
                    InstanceArn: instanceArn,
                    PermissionSetArn: permissionSetArn,
                    ManagedPolicyArn: item.newVal,
                  })
                );
                console.log(
                  `In permissionsettopic handler, processed managed policies-update-add-new-value for permission set ${permissionSetName}`
                );
                reProvision = true;
              } else if (
                ((item.path.toString() === "inlinePolicyDocument.Version" ||
                  item.path.toString() === "inlinePolicyDocument.Statement") &&
                  (item.diff === "updated" || item.diff === "created")) ||
                (item.path.toString().includes("inlinePolicyDocument") &&
                  (item.diff === "updated" ||
                    item.diff === "created" ||
                    item.diff === "deleted"))
              ) {
                // inline-version-or-statement updated or created
                // or
                // // inline-content changed
                inlinePolicyContentChange = true;
                reProvision = true;
              } else if (
                (item.path.toString() === "inlinePolicyDocument.Version" ||
                  item.path.toString() === "inlinePolicyDocument.Statement") &&
                item.diff === "deleted"
              ) {
                // inline-deleted
                await ssoAdminClientObject.send(
                  new DeleteInlinePolicyFromPermissionSetCommand({
                    InstanceArn: instanceArn,
                    PermissionSetArn: permissionSetArn,
                  })
                );
                console.log(
                  `In permissionsettopic handler, delete current inline policy for permission set ${permissionSetName}`
                );
                reProvision = true;
              } else if (
                item.path.toString() === "sessionDurationInMinutes" &&
                (item.diff === "updated" || item.diff === "created")
              ) {
                // sessionduraitoninminutes - created or updated
                updatePermissionSetAttributes = true;
              } else if (
                item.path.toString() === "relayState" &&
                (item.diff === "updated" || item.diff === "created")
              ) {
                // relayState - created or updated
                updatePermissionSetAttributes = true;
              } else if (
                /tags.\d$/gm.test(item.path.toString()) &&
                item.diff === "created"
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
                  })
                );
                console.log(
                  `In permissionsettopic handler, add new tag for permission set ${permissionSetName}`
                );
              } else if (
                /tags.\d$/gm.test(item.path.toString()) &&
                item.diff === "deleted"
              ) {
                // removing an existing tag
                await ssoAdminClientObject.send(
                  new UntagResourceCommand({
                    InstanceArn: instanceArn,
                    ResourceArn: permissionSetArn,
                    TagKeys: [item.oldVal.Key],
                  })
                );
                console.log(
                  `In permissionsettopic handler, remove existing tag for permission set ${permissionSetName}`
                );
              } else if (/tags.\d.[A-Za-z]*$/gm.test(item.path.toString())) {
                // Detected update of a tag key or value
                updateTags = true;
              }
            })
          );
          if (inlinePolicyContentChange) {
            // Processing Inline poilcy updates
            await ssoAdminClientObject.send(
              new PutInlinePolicyToPermissionSetCommand({
                InstanceArn: instanceArn,
                PermissionSetArn: permissionSetArn,
                InlinePolicy: JSON.stringify(currentInlinePolicy),
              })
            );
            console.log(
              `In permissionsettopic handler, processed inline policy update for permission set ${permissionSetName}`
            );
          }
          if (updatePermissionSetAttributes) {
            // Processing permission set attributes updates
            await ssoAdminClientObject.send(
              new UpdatePermissionSetCommand({
                PermissionSetArn: permissionSetArn,
                InstanceArn: instanceArn,
                SessionDuration: MinutesToISO8601Duration(
                  parseInt(currentSessionDuration)
                ),
                RelayState: currentRelayState,
              })
            );
            console.log(
              `In permissionsettopic handler, processed attribute update for permission set ${permissionSetName}`
            );
          }
          if (updateTags && currentTags.length !== 0) {
            // Processing Tag key or value updates
            await ssoAdminClientObject.send(
              new TagResourceCommand({
                InstanceArn: instanceArn,
                ResourceArn: permissionSetArn,
                Tags: currentTags,
              })
            );
            console.log(
              `In permissionsettopic handler, processed tag updates for permission set ${permissionSetName}`
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
              })
            );
            if (fetchAccountsList.AccountIds?.length !== 0) {
              const reProvisionOp = await ssoAdminClientObject.send(
                new ProvisionPermissionSetCommand({
                  InstanceArn: instanceArn,
                  PermissionSetArn: permissionSetArn,
                  TargetType: "ALL_PROVISIONED_ACCOUNTS",
                })
              );
              console.log(
                `In permissionsettopic handler, triggered re-provisioning for permission set ${permissionSetName} across ${fetchAccountsList.AccountIds?.length} number of accounts`
              );
              await snsClientObject.send(
                new PublishCommand({
                  TopicArn: waiterTopicArn,
                  Message: JSON.stringify({
                    waiter_name: "PermissionSetProvisioned",
                    instance_arn: instanceArn,
                    request_id:
                      reProvisionOp.PermissionSetProvisioningStatus?.RequestId,
                  }),
                })
              );
            }
          }

          if (!reProvision) {
            syncPermissionSet = true;
          }
        }
      }
    } else if (message.event_type === "REMOVE") {
      const currentItem = await ddbDocClientObject.send(
        new GetCommand({
          TableName: Arntable,
          Key: {
            permissionSetName,
          },
        })
      );
      if (currentItem.Item) {
        permissionSetArn = currentItem.Item.permissionSetArn;
        await ssoAdminClientObject.send(
          new DeletePermissionSetCommand({
            InstanceArn: instanceArn,
            PermissionSetArn: permissionSetArn,
          })
        );
        await ddbDocClientObject.send(
          new DeleteCommand({
            TableName: Arntable,
            Key: {
              permissionSetName,
            },
          })
        );
        console.log(
          `In permissionsettopic handler, processed deletion for permission set ${permissionSetName}`
        );
      }
    }

    if (syncPermissionSet) {
      await snsClientObject.send(
        new PublishCommand({
          TopicArn: permissionSetSyncTopicArn,
          Message: JSON.stringify({
            permission_set_name: permissionSetName,
            permission_set_arn: permissionSetArn,
          }),
        })
      );
      console.log(
        `In permissionsettopic handler, triggering sync logic for permission set ${permissionSetName}`
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
      `Exception when processing permission set topic: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`
    );
  }
};

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
  waiterHandlerSSOAPIRoleArn,
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
import { diff } from "json-diff";
import { waitUntilPermissionSetProvisioned } from "../../custom-waiters/src/waitUntilPermissionSetProvisioned";
import { ErrorMessage, requestStatus } from "../../helpers/src/interfaces";
import { serializeDurationToISOFormat } from "../../helpers/src/isoDurationUtility";
import { logger } from "../../helpers/src/utilities";

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });

const ssoAdminWaiterClientObject = new SSOAdminClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: waiterHandlerSSOAPIRoleArn,
    },
  }),
  maxAttempts: 2,
});

const ssoAdminClientObject = new SSOAdminClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: SSOAPIRoleArn,
    },
  }),
  maxAttempts: 2,
});
//Error notification
const errorMessage: ErrorMessage = {
  Subject: "Error Processing Permission Set Provisioning operation",
};

export const handler = async (event: SNSEvent) => {
  try {
    const message = JSON.parse(event.Records[0].Sns.Message);
    const permissionSetName = message.permissionSetName;
    const requestId = message.requestId;
    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
    let permissionSetArn = "";
    let syncPermissionSet = false;
    let reProvision = false;
    let updatePermissionSetAttributes = false;
    let currentInlinePolicy = "";
    let currentSessionDuration = "";
    let currentManagedPolicies: Array<string> = [];
    let currentRelayState = "";
    let currentTags: Array<Tag> = [];

    logger({
      handler: "permissionSetTopicProcessor",
      logMode: "info",
      requestId: requestId,
      relatedData: permissionSetName,
      status: requestStatus.InProgress,
      statusMessage: `PermissionSet topic processor ${message.action} operation in progress`,
    });
    if (message.action === "create") {
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
          RelayState: currentItem.Item?.relayState + "",
          SessionDuration: serializeDurationToISOFormat({
            minutes: parseInt(currentItem.Item?.sessionDurationInMinutes + ""),
          }),
        })
      );
      logger({
        handler: "permissionSetTopicProcessor",
        logMode: "info",
        requestId: requestId,
        relatedData: permissionSetName,
        status: requestStatus.InProgress,
        statusMessage: `PermissionSet create operation - object in AWS SSO`,
      });

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
      logger({
        handler: "permissionSetTopicProcessor",
        logMode: "info",
        requestId: requestId,
        relatedData: permissionSetName,
        status: requestStatus.InProgress,
        statusMessage: `PermissionSet create operation - arn updated in DDB with arn value: ${permissionSetArn}`,
      });
      if (currentItem.Item && currentItem.Item.tags.length !== 0) {
        await ssoAdminClientObject.send(
          new TagResourceCommand({
            InstanceArn: instanceArn,
            ResourceArn: createOp.PermissionSet?.PermissionSetArn?.toString(),
            Tags: currentItem.Item.tags,
          })
        );
        logger({
          handler: "permissionSetTopicProcessor",
          logMode: "info",
          requestId: requestId,
          relatedData: permissionSetName,
          status: requestStatus.InProgress,
          statusMessage: `PermissionSet create operation - tags updated`,
        });
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
        logger({
          handler: "permissionSetTopicProcessor",
          logMode: "info",
          requestId: requestId,
          relatedData: permissionSetName,
          status: requestStatus.InProgress,
          statusMessage: `PermissionSet create operation - managed Policies attached`,
        });
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

          logger({
            handler: "permissionSetTopicProcessor",
            logMode: "info",
            requestId: requestId,
            relatedData: permissionSetName,
            status: requestStatus.InProgress,
            statusMessage: `PermissionSet create operation - Inline Policy created`,
          });
        }
      }
      syncPermissionSet = true;
      logger({
        handler: "permissionSetTopicProcessor",
        logMode: "info",
        requestId: requestId,
        relatedData: permissionSetName,
        status: requestStatus.Completed,
        statusMessage: `PermissionSet create operation - completed`,
      });
    } else if (message.action === "update") {
      const currentItem: GetCommandOutput = await ddbDocClientObject.send(
        new GetCommand({
          TableName: DdbTable,
          Key: {
            permissionSetName,
          },
        })
      );
      const oldItem = message.oldPermissionSetData;
      const sortedOldItemManagedPolicies =
        oldItem.managedPoliciesArnList.sort();
      oldItem.managedPoliciesArnList = sortedOldItemManagedPolicies;
      const sortedCurrentItemManagedPolicies =
        currentItem.Item?.managedPoliciesArnList.sort();
      if (currentItem.Item) {
        currentItem.Item.managedPoliciesArnList =
          sortedCurrentItemManagedPolicies;
      }
      logger({
        handler: "permissionSetTopicProcessor",
        logMode: "info",
        requestId: requestId,
        relatedData: permissionSetName,
        status: requestStatus.InProgress,
        statusMessage: `PermissionSet update operation - Calculating delta`,
      });
      const diffCalculated = diff(oldItem, currentItem.Item);
      if (diffCalculated === undefined) {
        logger({
          handler: "permissionSetTopicProcessor",
          logMode: "info",
          requestId: requestId,
          relatedData: permissionSetName,
          status: requestStatus.Completed,
          statusMessage: `PermissionSet update operation - no delta determined, completing update operation`,
        });
      } else {
        const fetchArn: GetCommandOutput = await ddbDocClientObject.send(
          new GetCommand({
            TableName: Arntable,
            Key: {
              permissionSetName,
            },
          })
        );

        if (currentItem.Item && fetchArn.Item) {
          logger({
            handler: "permissionSetTopicProcessor",
            logMode: "info",
            requestId: requestId,
            relatedData: permissionSetName,
            status: requestStatus.InProgress,
            statusMessage: `PermissionSet update operation - object and arn found, progressing with delta`,
          });

          if (currentItem.Item.inlinePolicyDocument.length !== 0) {
            currentInlinePolicy = currentItem.Item.inlinePolicyDocument;
          }
          if (currentItem.Item.sessionDurationInMinutes.length !== 0) {
            currentSessionDuration = currentItem.Item.sessionDurationInMinutes;
          }
          if (currentItem.Item.relayState.length !== 0) {
            currentRelayState = currentItem.Item.relayState;
          }
          if (currentItem.Item.tags.length !== 0) {
            currentTags = currentItem.Item.tags;
          }
          if (currentItem.Item.managedPoliciesArnList) {
            currentManagedPolicies = currentItem.Item.managedPoliciesArnList;
          }

          permissionSetArn = fetchArn.Item.permissionSetArn;

          let k: keyof typeof diffCalculated;
          for (k in diffCalculated) {
            let changeType = "";
            let keyValue = "";
            let switchKey = "";
            if (k.toString().endsWith("__deleted")) {
              changeType = "remove";
              keyValue = k.toString().split("__")[0];
            } else if (k.toString().endsWith("__added")) {
              changeType = "add";
              keyValue = k.toString().split("__")[0];
            } else {
              changeType = "update";
              keyValue = k.toString();
            }
            switchKey = `${keyValue}-${changeType}`;
            switch (switchKey) {
              case "managedPoliciesArnList-add": {
                const changeSettoAdd: Array<string> = currentManagedPolicies;
                await Promise.all(
                  changeSettoAdd.map(async (managedPolicyArn: string) => {
                    await ssoAdminClientObject.send(
                      new AttachManagedPolicyToPermissionSetCommand({
                        InstanceArn: instanceArn,
                        PermissionSetArn: permissionSetArn,
                        ManagedPolicyArn: managedPolicyArn,
                      })
                    );
                  })
                );
                reProvision = true;
                logger({
                  handler: "permissionSetTopicProcessor",
                  logMode: "info",
                  requestId: requestId,
                  relatedData: permissionSetName,
                  status: requestStatus.InProgress,
                  statusMessage: `PermissionSet update operation - added managed policies`,
                });
                break;
              }
              case "managedPoliciesArnList-remove": {
                const changeSettoRemove: Array<string> =
                  oldItem.managedPoliciesArnList;
                await Promise.all(
                  changeSettoRemove.map(async (managedPolicyArn: string) => {
                    await ssoAdminClientObject.send(
                      new DetachManagedPolicyFromPermissionSetCommand({
                        InstanceArn: instanceArn,
                        PermissionSetArn: permissionSetArn,
                        ManagedPolicyArn: managedPolicyArn,
                      })
                    );
                  })
                );
                logger({
                  handler: "permissionSetTopicProcessor",
                  logMode: "info",
                  requestId: requestId,
                  relatedData: permissionSetName,
                  status: requestStatus.InProgress,
                  statusMessage: `PermissionSet update operation - removed managed policies`,
                });
                reProvision = true;
                break;
              }
              case "managedPoliciesArnList-update": {
                const changeSettoRemove: Array<string> = [];
                const changeSettoAdd: Array<string> = [];
                //Eslint disable as the payload has already been schema validated
                /* eslint-disable  security/detect-object-injection */
                const changeArray = diffCalculated[
                  k
                ] as unknown as Array<string>;
                await Promise.all(
                  changeArray.map(async (changeItem) => {
                    if (changeItem.toString().split(",")[0] === "+") {
                      changeSettoAdd.push(changeItem.toString().split(",")[1]);
                    } else if (changeItem.toString().split(",")[0] === "-") {
                      changeSettoRemove.push(
                        changeItem.toString().split(",")[1]
                      );
                    }
                  })
                );
                if (changeSettoRemove.length > 0) {
                  await Promise.all(
                    changeSettoRemove.map(async (managedPolicyArn: string) => {
                      await ssoAdminClientObject.send(
                        new DetachManagedPolicyFromPermissionSetCommand({
                          InstanceArn: instanceArn,
                          PermissionSetArn: permissionSetArn,
                          ManagedPolicyArn: managedPolicyArn,
                        })
                      );
                    })
                  );
                  logger({
                    handler: "permissionSetTopicProcessor",
                    logMode: "info",
                    requestId: requestId,
                    relatedData: permissionSetName,
                    status: requestStatus.InProgress,
                    statusMessage: `PermissionSet update operation - removed managed policies from changeSet calculated`,
                  });
                  reProvision = true;
                }
                if (changeSettoAdd.length > 0) {
                  await Promise.all(
                    changeSettoAdd.map(async (managedPolicyArn: string) => {
                      await ssoAdminClientObject.send(
                        new AttachManagedPolicyToPermissionSetCommand({
                          InstanceArn: instanceArn,
                          PermissionSetArn: permissionSetArn,
                          ManagedPolicyArn: managedPolicyArn,
                        })
                      );
                    })
                  );
                  logger({
                    handler: "permissionSetTopicProcessor",
                    logMode: "info",
                    requestId: requestId,
                    relatedData: permissionSetName,
                    status: requestStatus.InProgress,
                    statusMessage: `PermissionSet update operation - added managed policies from changeSet calculated`,
                  });
                  reProvision = true;
                }
                break;
              }
              case "inlinePolicyDocument-add":
              case "inlinePolicyDocument-update": {
                await ssoAdminClientObject.send(
                  new PutInlinePolicyToPermissionSetCommand({
                    InstanceArn: instanceArn,
                    PermissionSetArn: permissionSetArn,
                    InlinePolicy: JSON.stringify(currentInlinePolicy),
                  })
                );
                logger({
                  handler: "permissionSetTopicProcessor",
                  logMode: "info",
                  requestId: requestId,
                  relatedData: permissionSetName,
                  status: requestStatus.InProgress,
                  statusMessage: `PermissionSet update operation - create/updated inline policy document`,
                });
                reProvision = true;
                break;
              }
              case "inlinePolicyDocument-remove": {
                await ssoAdminClientObject.send(
                  new DeleteInlinePolicyFromPermissionSetCommand({
                    InstanceArn: instanceArn,
                    PermissionSetArn: permissionSetArn,
                  })
                );
                logger({
                  handler: "permissionSetTopicProcessor",
                  logMode: "info",
                  requestId: requestId,
                  relatedData: permissionSetName,
                  status: requestStatus.InProgress,
                  statusMessage: `PermissionSet update operation - removed inline policy document`,
                });
                reProvision = true;
                break;
              }
              case "sessionDurationInMinutes-add":
              case "sessionDurationInMinutes-remove":
              case "sessionDurationInMinutes-update":
              case "relayState-add":
              case "relayState-remove":
              case "relayState-update": {
                updatePermissionSetAttributes = true;
                logger({
                  handler: "permissionSetTopicProcessor",
                  logMode: "info",
                  requestId: requestId,
                  relatedData: permissionSetName,
                  status: requestStatus.InProgress,
                  statusMessage: `PermissionSet update operation - permission set attributes need update`,
                });
                break;
              }
              case "tags-add": {
                await ssoAdminClientObject.send(
                  new TagResourceCommand({
                    InstanceArn: instanceArn,
                    ResourceArn: permissionSetArn,
                    Tags: currentTags,
                  })
                );
                logger({
                  handler: "permissionSetTopicProcessor",
                  logMode: "info",
                  requestId: requestId,
                  relatedData: permissionSetName,
                  status: requestStatus.InProgress,
                  statusMessage: `PermissionSet update operation - added tags`,
                });
                break;
              }
              case "tags-update":
              case "tags-delete": {
                const tagKeysToRemove: Array<string> = [];
                if (oldItem.tags.length > 0) {
                  await Promise.all(
                    oldItem.tags.map(async (tag: Tag) => {
                      tagKeysToRemove.push(tag.Key?.toString() + "");
                    })
                  );
                }
                await ssoAdminClientObject.send(
                  new UntagResourceCommand({
                    InstanceArn: instanceArn,
                    ResourceArn: permissionSetArn,
                    TagKeys: tagKeysToRemove,
                  })
                );
                logger({
                  handler: "permissionSetTopicProcessor",
                  logMode: "info",
                  requestId: requestId,
                  relatedData: permissionSetName,
                  status: requestStatus.InProgress,
                  statusMessage: `PermissionSet update operation - removed old tags`,
                });
                if (switchKey === "tags-update") {
                  await ssoAdminClientObject.send(
                    new TagResourceCommand({
                      InstanceArn: instanceArn,
                      ResourceArn: permissionSetArn,
                      Tags: currentTags,
                    })
                  );
                  logger({
                    handler: "permissionSetTopicProcessor",
                    logMode: "info",
                    requestId: requestId,
                    relatedData: permissionSetName,
                    status: requestStatus.InProgress,
                    statusMessage: `PermissionSet update operation - added new tags`,
                  });
                }
                break;
              }
              default: {
                logger({
                  handler: "permissionSetTopicProcessor",
                  logMode: "error",
                  requestId: requestId,
                  relatedData: permissionSetName,
                  status: requestStatus.FailedWithError,
                  statusMessage: `PermissionSet update operation - unknown switchKey found: ${switchKey}`,
                });
              }
            }
          }

          if (updatePermissionSetAttributes) {
            // Processing permission set attributes updates
            await ssoAdminClientObject.send(
              new UpdatePermissionSetCommand({
                PermissionSetArn: permissionSetArn,
                InstanceArn: instanceArn,
                SessionDuration: serializeDurationToISOFormat({
                  minutes: parseInt(currentSessionDuration),
                }),
                RelayState: currentRelayState,
              })
            );
            logger({
              handler: "permissionSetTopicProcessor",
              logMode: "info",
              requestId: requestId,
              relatedData: permissionSetName,
              status: requestStatus.InProgress,
              statusMessage: `PermissionSet update operation - updated Permission set attributes`,
            });
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
              logger({
                handler: "permissionSetTopicProcessor",
                logMode: "info",
                requestId: requestId,
                relatedData: permissionSetName,
                status: requestStatus.InProgress,
                statusMessage: `PermissionSet update operation - triggered re-Provision and waiting for status`,
              });
              await waitUntilPermissionSetProvisioned(
                {
                  client: ssoAdminWaiterClientObject,
                  maxWaitTime: 600, //aggressive timeout to accommodate SSO Admin API's workflow based logic
                },
                {
                  InstanceArn: instanceArn,
                  ProvisionPermissionSetRequestId:
                    reProvisionOp.PermissionSetProvisioningStatus?.RequestId,
                },
                permissionSetName
              );
              logger({
                handler: "permissionSetTopicProcessor",
                logMode: "info",
                requestId: requestId,
                relatedData: permissionSetName,
                status: requestStatus.InProgress,
                statusMessage: `PermissionSet update operation - received status from re-Provision`,
              });
            }
          }

          if (!reProvision) {
            syncPermissionSet = true;
          }
        }
        logger({
          handler: "permissionSetTopicProcessor",
          logMode: "info",
          requestId: requestId,
          relatedData: permissionSetName,
          status: requestStatus.Completed,
          statusMessage: `PermissionSet update operation - complete`,
        });
      }
    } else if (message.action === "delete") {
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
        logger({
          handler: "permissionSetTopicProcessor",
          logMode: "info",
          requestId: requestId,
          relatedData: permissionSetName,
          status: requestStatus.Completed,
          statusMessage: `PermissionSet delete operation - completed`,
        });
      }
      logger({
        handler: "permissionSetTopicProcessor",
        logMode: "info",
        requestId: requestId,
        relatedData: permissionSetName,
        status: requestStatus.Completed,
        statusMessage: `PermissionSet delete operation - no reference found, so not deleting again`,
      });
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
  }
};

/**
 * Objective: Implement permission set CRUD operations Trigger source:
 * permission set topic notifications
 *
 * - Assumes role in SSO account for calling SSO admin API
 * - If operation type is insert
 *
 *   - Read complete permission set object from ddb table
 *   - Create permission set object with the params set for session duration, name,
 *       relay state and description
 *   - Upsert into permissionsetArn table with the value received from above
 *   - Apply tags to permission set if they exist
 *   - Apply managed policies to permission set if they exit
 *   - If inline policy exists, attach the inline policy to the permission set
 * - If operation type is modify
 *
 *   - Determine if the delta is any of the following: managed policies inline
 *       policy session duration relay state tags
 *   - Process update permission set if any of the above fields are changed
 *   - If the changes include managed policy or inline policy changes, trigger a
 *       reprovisioning operation as well and post the request id to waiter handler
 * - If operation type is delete
 *
 *   - Delete the permission set first
 *   - Then delete the permission set arn entry as well
 * - If operation type is create/delete, post permission set name, permission set
 *   arn, reprovision status to permission set sync topic
 * - Catch all failures in a generic exception block and post the error details to
 *   error notifications topics
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
  functionLogMode,
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;

import {
  DynamoDBClient,
  DynamoDBServiceException,
} from "@aws-sdk/client-dynamodb";
import {
  PublishCommand,
  SNSClient,
  SNSServiceException,
} from "@aws-sdk/client-sns";
import {
  AttachCustomerManagedPolicyReferenceToPermissionSetCommand,
  AttachManagedPolicyToPermissionSetCommand,
  CreatePermissionSetCommand,
  DeleteInlinePolicyFromPermissionSetCommand,
  DeletePermissionsBoundaryFromPermissionSetCommand,
  DeletePermissionSetCommand,
  DetachCustomerManagedPolicyReferenceFromPermissionSetCommand,
  DetachManagedPolicyFromPermissionSetCommand,
  ListAccountsForProvisionedPermissionSetCommand,
  ListInstancesCommand,
  ListInstancesCommandOutput,
  ProvisionPermissionSetCommand,
  PutInlinePolicyToPermissionSetCommand,
  PutPermissionsBoundaryToPermissionSetCommand,
  SSOAdminClient,
  SSOAdminServiceException,
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
import {
  CustomerManagedPolicyObject,
  logModes,
  requestStatus,
  Tag,
} from "../../helpers/src/interfaces";
import { serializeDurationToISOFormat } from "../../helpers/src/isoDurationUtility";
import {
  constructExceptionMessage,
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";

/** SDK and third party client object initialistaion */
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

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
const messageSubject = "Exception in permission set CRUD processing";
let requestIdValue = "";
let permissionSetNameValue = "";

export const handler = async (event: SNSEvent) => {
  const message = JSON.parse(event.Records[0].Sns.Message);
  requestIdValue = message.requestId;
  try {
    const permissionSetName = message.permissionSetName;
    permissionSetNameValue = permissionSetName;
    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestIdValue,
        relatedData: permissionSetNameValue,
        status: requestStatus.InProgress,
        statusMessage: `Initiating permission set CRUD logic`,
      },
      functionLogMode
    );
    const resolvedInstances: ListInstancesCommandOutput =
      await ssoAdminClientObject.send(new ListInstancesCommand({}));
    const instanceArn = resolvedInstances.Instances?.[0].InstanceArn + "";
    logger(
      {
        handler: handlerName,
        logMode: logModes.Debug,
        requestId: requestIdValue,
        relatedData: permissionSetNameValue,
        status: requestStatus.InProgress,
        statusMessage: `Resolved instanceArn as ${instanceArn}`,
      },
      functionLogMode
    );
    let permissionSetArn = "";
    let syncPermissionSet = false;
    let reProvision = false;
    let updatePermissionSetAttributes = false;
    let currentSessionDuration = "";
    let sortedManagedPoliciesArnList: Array<string> = [];
    let currentRelayState = "";
    let currentPermissionSetDescription = permissionSetName;
    let sessionDurationPresent = false;
    let relayStatePresent = false;

    logger(
      {
        handler: handlerName,
        logMode: logModes.Info,
        requestId: requestIdValue,
        relatedData: permissionSetNameValue,
        status: requestStatus.InProgress,
        statusMessage: `Determined permission set operation is of type ${message.action}`,
      },
      functionLogMode
    );

    const fetchPermissionSet: GetCommandOutput = await ddbDocClientObject.send(
      new GetCommand({
        TableName: DdbTable,
        Key: {
          permissionSetName,
        },
      })
    );
    if (fetchPermissionSet.Item) {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestIdValue,
          relatedData: permissionSetNameValue,
          status: requestStatus.InProgress,
          statusMessage: `Determined that permission set exists`,
        },
        functionLogMode
      );
      const currentItem = fetchPermissionSet.Item;
      if (message.action === "create") {
        const createOp = await ssoAdminClientObject.send(
          new CreatePermissionSetCommand({
            InstanceArn: instanceArn,
            Name: permissionSetName,
            Description: currentItem.description
              ? currentItem.description
              : permissionSetName,
          })
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestIdValue,
            relatedData: permissionSetNameValue,
            status: requestStatus.InProgress,
            statusMessage: `Triggered create operation for permissionSet in AWS SSO`,
          },
          functionLogMode
        );

        permissionSetArn =
          createOp.PermissionSet?.PermissionSetArn?.toString() + "";
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestIdValue,
            relatedData: permissionSetNameValue,
            status: requestStatus.InProgress,
            statusMessage: `createPermissionSet operation returned permissionSetArn as ${permissionSetArn}`,
          },
          functionLogMode
        );
        /**
         * Update relayState and sessionDuration if they match length greater
         * than 0 SSO Admin API sets sessionDuration to 60 mins when
         * un-specified Additionally, when only relayState is specified in the
         * updatePermissionSet call, the service updates the sessionDuration to
         * 60 mins irrespective of what it's previous value is So, the below
         * logic tries to circumvent this behaviour of the SSO admin API and
         * ensure that the end values reflect correctly
         */
        if (currentItem.relayState || currentItem.sessionDurationInMinutes) {
          if (
            currentItem.relayState &&
            currentItem.relayState.length > 0 &&
            currentItem.sessionDurationInMinutes &&
            currentItem.sessionDurationInMinutes.length > 0
          ) {
            await ssoAdminClientObject.send(
              new UpdatePermissionSetCommand({
                InstanceArn: instanceArn,
                PermissionSetArn: permissionSetArn,
                RelayState: currentItem.relayState,
                SessionDuration: serializeDurationToISOFormat({
                  minutes: parseInt(currentItem.sessionDurationInMinutes),
                }),
              })
            );
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestIdValue,
                relatedData: permissionSetNameValue,
                status: requestStatus.InProgress,
                statusMessage: `Updated relayState and sessionDuration for permissionSet create operation`,
              },
              functionLogMode
            );
          } else if (
            currentItem.relayState &&
            currentItem.relayState.length > 0
          ) {
            await ssoAdminClientObject.send(
              new UpdatePermissionSetCommand({
                InstanceArn: instanceArn,
                PermissionSetArn: permissionSetArn,
                RelayState: currentItem.relayState,
              })
            );
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestIdValue,
                relatedData: permissionSetNameValue,
                status: requestStatus.InProgress,
                statusMessage: `Updated relayState for permissionSet create operation`,
              },
              functionLogMode
            );
          } else if (
            currentItem.sessionDurationInMinutes &&
            currentItem.sessionDurationInMinutes.length > 0
          ) {
            await ssoAdminClientObject.send(
              new UpdatePermissionSetCommand({
                InstanceArn: instanceArn,
                PermissionSetArn: permissionSetArn,
                SessionDuration: serializeDurationToISOFormat({
                  minutes: parseInt(currentItem.sessionDurationInMinutes),
                }),
              })
            );
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestIdValue,
                relatedData: permissionSetNameValue,
                status: requestStatus.InProgress,
                statusMessage: `Updated sessionDuration for permissionSet create operation`,
              },
              functionLogMode
            );
          }
        }

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
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestIdValue,
            relatedData: permissionSetNameValue,
            status: requestStatus.InProgress,
            statusMessage: `Updated solution persistence with arn value for permission set create operation`,
          },
          functionLogMode
        );
        if (currentItem.tags.length !== 0) {
          await ssoAdminClientObject.send(
            new TagResourceCommand({
              InstanceArn: instanceArn,
              ResourceArn: createOp.PermissionSet?.PermissionSetArn?.toString(),
              Tags: currentItem.tags,
            })
          );
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestIdValue,
              relatedData: permissionSetNameValue,
              status: requestStatus.InProgress,
              statusMessage: `Updated tags for permissionSet create operation`,
            },
            functionLogMode
          );
        }
        if (
          currentItem.managedPoliciesArnList &&
          currentItem.managedPoliciesArnList.length !== 0
        ) {
          /**
           * TODO: This will fail for more than one item in the map until
           * https://github.com/aws/aws-sdk-js-v3/issues/3822 is fixed
           */
          await Promise.all(
            currentItem.managedPoliciesArnList.map(
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
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestIdValue,
              relatedData: permissionSetNameValue,
              status: requestStatus.InProgress,
              statusMessage: `Managed policies attached for permissionSet create operation`,
            },
            functionLogMode
          );
        }
        if (
          currentItem.customerManagedPoliciesList &&
          currentItem.customerManagedPoliciesList.length !== 0
        ) {
          /**
           * TODO: This will fail for more than one item in the map until
           * https://github.com/aws/aws-sdk-js-v3/issues/3822 is fixed
           */
          await Promise.all(
            currentItem.customerManagedPoliciesList.map(
              async (customerManagedPolicy: CustomerManagedPolicyObject) => {
                if (
                  customerManagedPolicy.Path &&
                  customerManagedPolicy.Path.length > 0
                ) {
                  await ssoAdminClientObject.send(
                    new AttachCustomerManagedPolicyReferenceToPermissionSetCommand(
                      {
                        InstanceArn: instanceArn,
                        PermissionSetArn:
                          createOp.PermissionSet?.PermissionSetArn?.toString(),
                        CustomerManagedPolicyReference: {
                          Name: customerManagedPolicy.Name,
                          Path: customerManagedPolicy.Path,
                        },
                      }
                    )
                  );
                  logger(
                    {
                      handler: handlerName,
                      logMode: logModes.Debug,
                      requestId: requestIdValue,
                      relatedData: permissionSetNameValue,
                      status: requestStatus.InProgress,
                      statusMessage: `Customer Manged Policy with name ${customerManagedPolicy.Name} and path ${customerManagedPolicy.Path} attached to permissionSet`,
                    },
                    functionLogMode
                  );
                } else {
                  await ssoAdminClientObject.send(
                    new AttachCustomerManagedPolicyReferenceToPermissionSetCommand(
                      {
                        InstanceArn: instanceArn,
                        PermissionSetArn:
                          createOp.PermissionSet?.PermissionSetArn?.toString(),
                        CustomerManagedPolicyReference: {
                          Name: customerManagedPolicy.Name,
                        },
                      }
                    )
                  );
                  logger(
                    {
                      handler: handlerName,
                      logMode: logModes.Debug,
                      requestId: requestIdValue,
                      relatedData: permissionSetNameValue,
                      status: requestStatus.InProgress,
                      statusMessage: `Customer Manged Policy with name ${customerManagedPolicy.Name} attached to permissionSet`,
                    },
                    functionLogMode
                  );
                }
              }
            )
          );
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestIdValue,
              relatedData: permissionSetNameValue,
              status: requestStatus.InProgress,
              statusMessage: `Customer managed policies attached for permissionSet create operation`,
            },
            functionLogMode
          );
        }

        if ("inlinePolicyDocument" in currentItem) {
          if (Object.keys(currentItem.inlinePolicyDocument).length !== 0) {
            await ssoAdminClientObject.send(
              new PutInlinePolicyToPermissionSetCommand({
                InstanceArn: instanceArn,
                InlinePolicy: JSON.stringify(currentItem.inlinePolicyDocument),
                PermissionSetArn:
                  createOp.PermissionSet?.PermissionSetArn?.toString(),
              })
            );
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestIdValue,
                relatedData: permissionSetNameValue,
                status: requestStatus.InProgress,
                statusMessage: `Inline policy created for permission set create operation`,
              },
              functionLogMode
            );
          }
        }

        if ("permissionsBoundary" in currentItem) {
          if (Object.keys(currentItem.permissionsBoundary).length !== 0) {
            await ssoAdminClientObject.send(
              new PutPermissionsBoundaryToPermissionSetCommand({
                InstanceArn: instanceArn,
                PermissionSetArn:
                  createOp.PermissionSet?.PermissionSetArn?.toString(),
                PermissionsBoundary: { ...currentItem.permissionsBoundary },
              })
            );
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestIdValue,
                relatedData: permissionSetNameValue,
                status: requestStatus.InProgress,
                statusMessage: `Permissions Boundary attached for permission set create operation`,
              },
              functionLogMode
            );
          }
        }

        syncPermissionSet = true;
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestIdValue,
            relatedData: permissionSetNameValue,
            status: requestStatus.Completed,
            statusMessage: `permissionSet create operation completed`,
          },
          functionLogMode
        );
      } else if (message.action === "update") {
        const oldItem = message.oldPermissionSetData;

        /**
         * Sort managed policies before delta calculation and prepare the
         * permission sorted objects to compare using the sorted lists
         */
        const sortedOldItemManagedPoliciesArnList: Array<string> =
          oldItem.managedPoliciesArnList.sort();
        const sortedCurrentItemManagedPoliciesArnList: Array<string> =
          currentItem.managedPoliciesArnList.sort();
        delete oldItem["managedPoliciesArnList"];
        delete currentItem["managedPoliciesArnList"];
        oldItem["sortedManagedPoliciesArnList"] =
          sortedOldItemManagedPoliciesArnList;
        currentItem["sortedManagedPoliciesArnList"] =
          sortedCurrentItemManagedPoliciesArnList;

        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestIdValue,
            relatedData: permissionSetNameValue,
            status: requestStatus.InProgress,
            statusMessage: `calculating delta for permissionSet update operation`,
          },
          functionLogMode
        );

        const diffCalculated = diff(oldItem, currentItem);

        if (diffCalculated === undefined) {
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestIdValue,
              relatedData: permissionSetNameValue,
              status: requestStatus.Completed,
              statusMessage: `No delta determined for permissionSet update operation, completing update operation`,
            },
            functionLogMode
          );
        } else {
          const fetchArn: GetCommandOutput = await ddbDocClientObject.send(
            new GetCommand({
              TableName: Arntable,
              Key: {
                permissionSetName,
              },
            })
          );
          if (fetchArn.Item) {
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                requestId: requestIdValue,
                relatedData: permissionSetNameValue,
                status: requestStatus.InProgress,
                statusMessage: `objectArn found, progressing with delta for permission Set update operation`,
              },
              functionLogMode
            );
            if (
              currentItem.sessionDurationInMinutes &&
              currentItem.sessionDurationInMinutes.length > 0
            ) {
              currentSessionDuration = currentItem.sessionDurationInMinutes;
              sessionDurationPresent = true;
            }
            if (currentItem.relayState && currentItem.relayState.length > 0) {
              currentRelayState = currentItem.relayState;
              relayStatePresent = true;
            }
            if (currentItem.sortedManagedPoliciesArnList) {
              sortedManagedPoliciesArnList =
                currentItem.sortedManagedPoliciesArnList;
            }
            if (
              currentItem.description &&
              currentItem.description.length !== 0
            ) {
              currentPermissionSetDescription = currentItem.description;
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
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Debug,
                  requestId: requestIdValue,
                  relatedData: permissionSetNameValue,
                  status: requestStatus.InProgress,
                  statusMessage: `Determining delta for switchKey ${switchKey} as part of permissionSet update operation`,
                },
                functionLogMode
              );

              switch (switchKey) {
                case "sortedManagedPoliciesArnList-add": {
                  const changeSettoAdd: Array<string> =
                    sortedManagedPoliciesArnList;
                  for (const managedPolicyArn of changeSettoAdd) {
                    await ssoAdminClientObject.send(
                      new AttachManagedPolicyToPermissionSetCommand({
                        InstanceArn: instanceArn,
                        PermissionSetArn: permissionSetArn,
                        ManagedPolicyArn: managedPolicyArn,
                      })
                    );
                  }
                  reProvision = true;
                  logger(
                    {
                      handler: handlerName,
                      logMode: logModes.Info,
                      requestId: requestIdValue,
                      relatedData: permissionSetNameValue,
                      status: requestStatus.InProgress,
                      statusMessage: `added managed policies for permission Set update operation`,
                    },
                    functionLogMode
                  );

                  break;
                }
                case "sortedManagedPoliciesArnList-remove": {
                  const changeSettoRemove: Array<string> =
                    oldItem.sortedManagedPoliciesArnList;
                  for (const managedPolicyArn of changeSettoRemove) {
                    await ssoAdminClientObject.send(
                      new DetachManagedPolicyFromPermissionSetCommand({
                        InstanceArn: instanceArn,
                        PermissionSetArn: permissionSetArn,
                        ManagedPolicyArn: managedPolicyArn,
                      })
                    );
                  }
                  reProvision = true;
                  logger(
                    {
                      handler: handlerName,
                      logMode: logModes.Info,
                      requestId: requestIdValue,
                      relatedData: permissionSetNameValue,
                      status: requestStatus.InProgress,
                      statusMessage: `removed managed policies for permission Set update operation`,
                    },
                    functionLogMode
                  );

                  break;
                }
                case "sortedManagedPoliciesArnList-update": {
                  /** Eslint disable to force the declaration to be let instead of const */
                  /* eslint-disable  prefer-const  */
                  let changeSettoRemove: Array<string> = [];
                  /* eslint-disable  prefer-const  */
                  let changeSettoAdd: Array<string> = [];
                  /** Eslint disable as the payload has already been schema validated */
                  /* eslint-disable  security/detect-object-injection */
                  const changeArray = diffCalculated[
                    k
                  ] as unknown as Array<string>;
                  await Promise.all(
                    changeArray.map(async (changeItem) => {
                      if (changeItem.toString().split(",")[0] === "+") {
                        changeSettoAdd.push(
                          changeItem.toString().split(",")[1]
                        );
                      } else if (changeItem.toString().split(",")[0] === "-") {
                        changeSettoRemove.push(
                          changeItem.toString().split(",")[1]
                        );
                      }
                    })
                  );
                  if (changeSettoRemove.length > 0) {
                    for (const managedPolicyArn of changeSettoRemove) {
                      await ssoAdminClientObject.send(
                        new DetachManagedPolicyFromPermissionSetCommand({
                          InstanceArn: instanceArn,
                          PermissionSetArn: permissionSetArn,
                          ManagedPolicyArn: managedPolicyArn,
                        })
                      );
                    }

                    reProvision = true;
                    logger(
                      {
                        handler: handlerName,
                        logMode: logModes.Info,
                        requestId: requestIdValue,
                        relatedData: permissionSetNameValue,
                        status: requestStatus.InProgress,
                        statusMessage: `removed managed policies from changeSet calculated for permission Set update operation`,
                      },
                      functionLogMode
                    );
                  }
                  if (changeSettoAdd.length > 0) {
                    for (const managedPolicyArn of changeSettoAdd) {
                      await ssoAdminClientObject.send(
                        new AttachManagedPolicyToPermissionSetCommand({
                          InstanceArn: instanceArn,
                          PermissionSetArn: permissionSetArn,
                          ManagedPolicyArn: managedPolicyArn,
                        })
                      );
                    }

                    logger(
                      {
                        handler: handlerName,
                        logMode: logModes.Info,
                        requestId: requestIdValue,
                        relatedData: permissionSetNameValue,
                        status: requestStatus.InProgress,
                        statusMessage: `added managed policies from changeSet calculated for permission Set update operation`,
                      },
                      functionLogMode
                    );

                    reProvision = true;
                  }
                  break;
                }
                case "customerManagedPoliciesList-add": {
                  if (currentItem.customerManagedPoliciesList.length !== 0) {
                    /**
                     * TODO: This will fail for more than one item in the map
                     * until https://github.com/aws/aws-sdk-js-v3/issues/3822 is fixed
                     */
                    await Promise.all(
                      currentItem.customerManagedPoliciesList.map(
                        async (
                          customerManagedPolicy: CustomerManagedPolicyObject
                        ) => {
                          if (
                            customerManagedPolicy.Path &&
                            customerManagedPolicy.Path.length > 0
                          ) {
                            await ssoAdminClientObject.send(
                              new AttachCustomerManagedPolicyReferenceToPermissionSetCommand(
                                {
                                  InstanceArn: instanceArn,
                                  PermissionSetArn: permissionSetArn,
                                  CustomerManagedPolicyReference: {
                                    Name: customerManagedPolicy.Name,
                                    Path: customerManagedPolicy.Path,
                                  },
                                }
                              )
                            );
                            logger(
                              {
                                handler: handlerName,
                                logMode: logModes.Debug,
                                requestId: requestIdValue,
                                relatedData: permissionSetNameValue,
                                status: requestStatus.InProgress,
                                statusMessage: `Customer Manged Policy with name ${customerManagedPolicy.Name} and path ${customerManagedPolicy.Path} attached to permissionSet`,
                              },
                              functionLogMode
                            );
                          } else {
                            await ssoAdminClientObject.send(
                              new AttachCustomerManagedPolicyReferenceToPermissionSetCommand(
                                {
                                  InstanceArn: instanceArn,
                                  PermissionSetArn: permissionSetArn,
                                  CustomerManagedPolicyReference: {
                                    Name: customerManagedPolicy.Name,
                                  },
                                }
                              )
                            );
                            logger(
                              {
                                handler: handlerName,
                                logMode: logModes.Debug,
                                requestId: requestIdValue,
                                relatedData: permissionSetNameValue,
                                status: requestStatus.InProgress,
                                statusMessage: `Customer Manged Policy with name ${customerManagedPolicy.Name} attached to permissionSet`,
                              },
                              functionLogMode
                            );
                          }
                        }
                      )
                    );
                    reProvision = true;
                  }

                  break;
                }
                case "customerManagedPoliciesList-update": {
                  if (oldItem.customerManagedPoliciesList.length !== 0) {
                    /**
                     * TODO: This will fail for more than one item in the map
                     * until https://github.com/aws/aws-sdk-js-v3/issues/3822 is fixed
                     */
                    await Promise.all(
                      oldItem.customerManagedPoliciesList.map(
                        async (
                          customerManagedPolicy: CustomerManagedPolicyObject
                        ) => {
                          if (
                            customerManagedPolicy.Path &&
                            customerManagedPolicy.Path.length > 0
                          ) {
                            await ssoAdminClientObject.send(
                              new DetachCustomerManagedPolicyReferenceFromPermissionSetCommand(
                                {
                                  InstanceArn: instanceArn,
                                  PermissionSetArn: permissionSetArn,
                                  CustomerManagedPolicyReference: {
                                    Name: customerManagedPolicy.Name,
                                    Path: customerManagedPolicy.Path,
                                  },
                                }
                              )
                            );
                            logger(
                              {
                                handler: handlerName,
                                logMode: logModes.Debug,
                                requestId: requestIdValue,
                                relatedData: permissionSetNameValue,
                                status: requestStatus.InProgress,
                                statusMessage: `Customer Manged Policy with name ${customerManagedPolicy.Name} and path ${customerManagedPolicy.Path} detached from permissionSet`,
                              },
                              functionLogMode
                            );
                          } else {
                            await ssoAdminClientObject.send(
                              new DetachCustomerManagedPolicyReferenceFromPermissionSetCommand(
                                {
                                  InstanceArn: instanceArn,
                                  PermissionSetArn: permissionSetArn,
                                  CustomerManagedPolicyReference: {
                                    Name: customerManagedPolicy.Name,
                                  },
                                }
                              )
                            );
                            logger(
                              {
                                handler: handlerName,
                                logMode: logModes.Debug,
                                requestId: requestIdValue,
                                relatedData: permissionSetNameValue,
                                status: requestStatus.InProgress,
                                statusMessage: `Customer Manged Policy with name ${customerManagedPolicy.Name} detached from permissionSet`,
                              },
                              functionLogMode
                            );
                          }
                        }
                      )
                    );
                    reProvision = true;
                  }
                  if (currentItem.customerManagedPoliciesList.length !== 0) {
                    /**
                     * TODO: This will fail for more than one item in the map
                     * until https://github.com/aws/aws-sdk-js-v3/issues/3822 is fixed
                     */
                    await Promise.all(
                      currentItem.customerManagedPoliciesList.map(
                        async (
                          customerManagedPolicy: CustomerManagedPolicyObject
                        ) => {
                          if (
                            customerManagedPolicy.Path &&
                            customerManagedPolicy.Path.length > 0
                          ) {
                            await ssoAdminClientObject.send(
                              new AttachCustomerManagedPolicyReferenceToPermissionSetCommand(
                                {
                                  InstanceArn: instanceArn,
                                  PermissionSetArn: permissionSetArn,
                                  CustomerManagedPolicyReference: {
                                    Name: customerManagedPolicy.Name,
                                    Path: customerManagedPolicy.Path,
                                  },
                                }
                              )
                            );
                            logger(
                              {
                                handler: handlerName,
                                logMode: logModes.Debug,
                                requestId: requestIdValue,
                                relatedData: permissionSetNameValue,
                                status: requestStatus.InProgress,
                                statusMessage: `Customer Manged Policy with name ${customerManagedPolicy.Name} and path ${customerManagedPolicy.Path} attached to permissionSet`,
                              },
                              functionLogMode
                            );
                          } else {
                            await ssoAdminClientObject.send(
                              new AttachCustomerManagedPolicyReferenceToPermissionSetCommand(
                                {
                                  InstanceArn: instanceArn,
                                  PermissionSetArn: permissionSetArn,
                                  CustomerManagedPolicyReference: {
                                    Name: customerManagedPolicy.Name,
                                  },
                                }
                              )
                            );
                            logger(
                              {
                                handler: handlerName,
                                logMode: logModes.Debug,
                                requestId: requestIdValue,
                                relatedData: permissionSetNameValue,
                                status: requestStatus.InProgress,
                                statusMessage: `Customer Manged Policy with name ${customerManagedPolicy.Name} attached to permissionSet`,
                              },
                              functionLogMode
                            );
                          }
                        }
                      )
                    );
                    reProvision = true;
                  }
                  break;
                }
                case "customerManagedPoliciesList-remove": {
                  if (oldItem.customerManagedPoliciesList.length !== 0) {
                    /**
                     * TODO: This will fail for more than one item in the map
                     * until https://github.com/aws/aws-sdk-js-v3/issues/3822 is fixed
                     */
                    await Promise.all(
                      oldItem.customerManagedPoliciesList.map(
                        async (
                          customerManagedPolicy: CustomerManagedPolicyObject
                        ) => {
                          if (
                            customerManagedPolicy.Path &&
                            customerManagedPolicy.Path.length > 0
                          ) {
                            await ssoAdminClientObject.send(
                              new DetachCustomerManagedPolicyReferenceFromPermissionSetCommand(
                                {
                                  InstanceArn: instanceArn,
                                  PermissionSetArn: permissionSetArn,
                                  CustomerManagedPolicyReference: {
                                    Name: customerManagedPolicy.Name,
                                    Path: customerManagedPolicy.Path,
                                  },
                                }
                              )
                            );
                            logger(
                              {
                                handler: handlerName,
                                logMode: logModes.Debug,
                                requestId: requestIdValue,
                                relatedData: permissionSetNameValue,
                                status: requestStatus.InProgress,
                                statusMessage: `Customer Manged Policy with name ${customerManagedPolicy.Name} and path ${customerManagedPolicy.Path} detached from permissionSet`,
                              },
                              functionLogMode
                            );
                          } else {
                            await ssoAdminClientObject.send(
                              new DetachCustomerManagedPolicyReferenceFromPermissionSetCommand(
                                {
                                  InstanceArn: instanceArn,
                                  PermissionSetArn: permissionSetArn,
                                  CustomerManagedPolicyReference: {
                                    Name: customerManagedPolicy.Name,
                                  },
                                }
                              )
                            );
                            logger(
                              {
                                handler: handlerName,
                                logMode: logModes.Debug,
                                requestId: requestIdValue,
                                relatedData: permissionSetNameValue,
                                status: requestStatus.InProgress,
                                statusMessage: `Customer Manged Policy with name ${customerManagedPolicy.Name} detached from permissionSet`,
                              },
                              functionLogMode
                            );
                          }
                        }
                      )
                    );
                    reProvision = true;
                  }
                  break;
                }
                case "permissionsBoundary-add":
                case "permissionsBoundary-update": {
                  if (
                    Object.keys(currentItem.permissionsBoundary).length !== 0
                  ) {
                    await ssoAdminClientObject.send(
                      new PutPermissionsBoundaryToPermissionSetCommand({
                        InstanceArn: instanceArn,
                        PermissionSetArn: permissionSetArn,
                        PermissionsBoundary: {
                          ...currentItem.permissionsBoundary,
                        },
                      })
                    );
                    logger(
                      {
                        handler: handlerName,
                        logMode: logModes.Info,
                        requestId: requestIdValue,
                        relatedData: permissionSetNameValue,
                        status: requestStatus.InProgress,
                        statusMessage: `created/updated permission set boundary for permission Set update operation`,
                      },
                      functionLogMode
                    );
                    reProvision = true;
                  }
                  break;
                }
                case "permissionsBoundary-remove": {
                  await ssoAdminClientObject.send(
                    new DeletePermissionsBoundaryFromPermissionSetCommand({
                      InstanceArn: instanceArn,
                      PermissionSetArn: permissionSetArn,
                    })
                  );
                  logger(
                    {
                      handler: handlerName,
                      logMode: logModes.Info,
                      requestId: requestIdValue,
                      relatedData: permissionSetNameValue,
                      status: requestStatus.InProgress,
                      statusMessage: `removed permission set boundary for permission Set update operation`,
                    },
                    functionLogMode
                  );
                  reProvision = true;
                  break;
                }
                case "inlinePolicyDocument-add":
                case "inlinePolicyDocument-update": {
                  if (
                    Object.keys(currentItem.inlinePolicyDocument).length !== 0
                  ) {
                    await ssoAdminClientObject.send(
                      new PutInlinePolicyToPermissionSetCommand({
                        InstanceArn: instanceArn,
                        PermissionSetArn: permissionSetArn,
                        InlinePolicy: JSON.stringify(
                          currentItem.inlinePolicyDocument
                        ),
                      })
                    );
                    logger(
                      {
                        handler: handlerName,
                        logMode: logModes.Info,
                        requestId: requestIdValue,
                        relatedData: permissionSetNameValue,
                        status: requestStatus.InProgress,
                        statusMessage: `created/updated inline policy document for permission Set update operation`,
                      },
                      functionLogMode
                    );

                    reProvision = true;
                  }
                  break;
                }
                case "inlinePolicyDocument-remove": {
                  await ssoAdminClientObject.send(
                    new DeleteInlinePolicyFromPermissionSetCommand({
                      InstanceArn: instanceArn,
                      PermissionSetArn: permissionSetArn,
                    })
                  );
                  logger(
                    {
                      handler: handlerName,
                      logMode: logModes.Info,
                      requestId: requestIdValue,
                      relatedData: permissionSetNameValue,
                      status: requestStatus.InProgress,
                      statusMessage: `removed inlinePolicy document for permission Set update operation`,
                    },
                    functionLogMode
                  );

                  reProvision = true;
                  break;
                }
                case "sessionDurationInMinutes-add":
                case "sessionDurationInMinutes-remove":
                case "sessionDurationInMinutes-update":
                case "description-add":
                case "description-remove":
                case "description-update":
                case "relayState-add":
                case "relayState-remove":
                case "relayState-update": {
                  updatePermissionSetAttributes = true;
                  reProvision = true;
                  logger(
                    {
                      handler: handlerName,
                      logMode: logModes.Info,
                      requestId: requestIdValue,
                      relatedData: permissionSetNameValue,
                      status: requestStatus.InProgress,
                      statusMessage: `set flag for updating permission set attributes as part of permission Set update operation`,
                    },
                    functionLogMode
                  );

                  break;
                }
                case "tags-add": {
                  await ssoAdminClientObject.send(
                    new TagResourceCommand({
                      InstanceArn: instanceArn,
                      ResourceArn: permissionSetArn,
                      Tags: currentItem.tags,
                    })
                  );
                  logger(
                    {
                      handler: handlerName,
                      logMode: logModes.Info,
                      requestId: requestIdValue,
                      relatedData: permissionSetNameValue,
                      status: requestStatus.InProgress,
                      statusMessage: `added tags for permission Set update operation`,
                    },
                    functionLogMode
                  );

                  break;
                }
                case "tags-update":
                case "tags-delete": {
                  if (oldItem.tags && oldItem.tags.length > 0) {
                    /** Eslint disable to force the declaration to be let instead of const */
                    /* eslint-disable  prefer-const  */
                    let tagKeysToRemove: Array<string> = [];
                    await Promise.all(
                      oldItem.tags.map(async (tag: Tag) => {
                        tagKeysToRemove.push(tag.Key?.toString() + "");
                      })
                    );
                    await ssoAdminClientObject.send(
                      new UntagResourceCommand({
                        InstanceArn: instanceArn,
                        ResourceArn: permissionSetArn,
                        TagKeys: tagKeysToRemove,
                      })
                    );
                    logger(
                      {
                        handler: handlerName,
                        logMode: logModes.Info,
                        requestId: requestIdValue,
                        relatedData: permissionSetNameValue,
                        status: requestStatus.InProgress,
                        statusMessage: `removed old tags for permission Set update operation`,
                      },
                      functionLogMode
                    );
                  }
                  if (switchKey === "tags-update" && currentItem.tags) {
                    await ssoAdminClientObject.send(
                      new TagResourceCommand({
                        InstanceArn: instanceArn,
                        ResourceArn: permissionSetArn,
                        Tags: currentItem.tags,
                      })
                    );
                    logger(
                      {
                        handler: handlerName,
                        logMode: logModes.Info,
                        requestId: requestIdValue,
                        relatedData: permissionSetNameValue,
                        status: requestStatus.InProgress,
                        statusMessage: `added new tags for permission Set update operation`,
                      },
                      functionLogMode
                    );
                  }
                  break;
                }
                default: {
                  logger(
                    {
                      handler: handlerName,
                      logMode: logModes.Exception,
                      requestId: requestIdValue,
                      relatedData: permissionSetNameValue,
                      status: requestStatus.FailedWithException,
                      statusMessage: `unknown switch key found for permissionSet update operation ${switchKey}`,
                    },
                    functionLogMode
                  );
                }
              }
            }

            if (updatePermissionSetAttributes) {
              /** Processing permission set attributes updates */
              await ssoAdminClientObject.send(
                new UpdatePermissionSetCommand({
                  PermissionSetArn: permissionSetArn,
                  InstanceArn: instanceArn,
                  Description: currentPermissionSetDescription,
                })
              );
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  requestId: requestIdValue,
                  relatedData: permissionSetNameValue,
                  status: requestStatus.InProgress,
                  statusMessage: `updated permission set attributes for permission Set update operation`,
                },
                functionLogMode
              );

              /**
               * Update relayState and sessionDuration if they match length
               * greater than 0 SSO Admin API sets sessionDuration to 60 mins
               * when un-specified Additionally, when only relayState is
               * specified in the updatePermissionSet call, the service updates
               * the sessionDuration to 60 mins irrespective of what it's
               * previous value is So, the below logic tries to circumvent this
               * behaviour of the SSO admin API and ensure that the end values
               * reflect correctly
               */
              if (relayStatePresent && sessionDurationPresent) {
                await ssoAdminClientObject.send(
                  new UpdatePermissionSetCommand({
                    PermissionSetArn: permissionSetArn,
                    InstanceArn: instanceArn,
                    RelayState: currentRelayState,
                    SessionDuration: serializeDurationToISOFormat({
                      minutes: parseInt(currentSessionDuration),
                    }),
                  })
                );
                logger(
                  {
                    handler: handlerName,
                    logMode: logModes.Info,
                    requestId: requestIdValue,
                    relatedData: permissionSetNameValue,
                    status: requestStatus.InProgress,
                    statusMessage: `updated relayState and currentSessionDuration for permission Set update operation`,
                  },
                  functionLogMode
                );
              } else if (relayStatePresent) {
                await ssoAdminClientObject.send(
                  new UpdatePermissionSetCommand({
                    PermissionSetArn: permissionSetArn,
                    InstanceArn: instanceArn,
                    RelayState: currentRelayState,
                  })
                );
                logger(
                  {
                    handler: handlerName,
                    logMode: logModes.Info,
                    requestId: requestIdValue,
                    relatedData: permissionSetNameValue,
                    status: requestStatus.InProgress,
                    statusMessage: `updated relayState for permission Set update operation`,
                  },
                  functionLogMode
                );
              } else if (sessionDurationPresent) {
                await ssoAdminClientObject.send(
                  new UpdatePermissionSetCommand({
                    PermissionSetArn: permissionSetArn,
                    InstanceArn: instanceArn,
                    SessionDuration: serializeDurationToISOFormat({
                      minutes: parseInt(currentSessionDuration),
                    }),
                  })
                );
                logger(
                  {
                    handler: handlerName,
                    logMode: logModes.Info,
                    requestId: requestIdValue,
                    relatedData: permissionSetNameValue,
                    status: requestStatus.InProgress,
                    statusMessage: `updated sessionDuration for permission Set update operation`,
                  },
                  functionLogMode
                );
              }
            }

            if (reProvision) {
              /**
               * Permission set had an update on managed policies or inline
               * policy content, so triggering re-provisioning operation to
               * ALL_PROVISIONED_ACCOUNTS
               * ListAccountsForProvisionedPermissionSetCommand is a paginated
               * operation, however won't paginate through the iterator as we
               * are interested if the result set is more than 0 only
               */
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
                logger(
                  {
                    handler: handlerName,
                    logMode: logModes.Info,
                    requestId: requestIdValue,
                    relatedData: permissionSetNameValue,
                    status: requestStatus.InProgress,
                    statusMessage: `triggered re-provisioning for permission Set update operation`,
                  },
                  functionLogMode
                );

                await waitUntilPermissionSetProvisioned(
                  {
                    client: ssoAdminWaiterClientObject,
                    maxWaitTime: 600 /** Aggressive timeout to accommodate SSO Admin API's workflow based logic */,
                  },
                  {
                    InstanceArn: instanceArn,
                    ProvisionPermissionSetRequestId:
                      reProvisionOp.PermissionSetProvisioningStatus?.RequestId,
                  },
                  permissionSetName
                );
                logger(
                  {
                    handler: handlerName,
                    logMode: logModes.Info,
                    requestId: requestIdValue,
                    relatedData: permissionSetNameValue,
                    status: requestStatus.InProgress,
                    statusMessage: `re-provisioning operation completed for permission Set update operation`,
                  },
                  functionLogMode
                );
              }
            }

            if (!reProvision) {
              syncPermissionSet = true;
            }
          }
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestIdValue,
              relatedData: permissionSetNameValue,
              status: requestStatus.Completed,
              statusMessage: `permission Set update operation completed`,
            },
            functionLogMode
          );
        }
      } else if (message.action === "delete") {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestIdValue,
            relatedData: permissionSetNameValue,
            status: requestStatus.InProgress,
            statusMessage: `permission Set delete operation started`,
          },
          functionLogMode
        );
        const fetchArn = await ddbDocClientObject.send(
          new GetCommand({
            TableName: Arntable,
            Key: {
              permissionSetName,
            },
          })
        );
        if (fetchArn.Item) {
          permissionSetArn = fetchArn.Item.permissionSetArn;
          await ssoAdminClientObject.send(
            new DeletePermissionSetCommand({
              InstanceArn: instanceArn,
              PermissionSetArn: permissionSetArn,
            })
          );
          await ddbDocClientObject.send(
            new DeleteCommand({
              TableName: DdbTable,
              Key: {
                permissionSetName,
              },
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
          logger(
            {
              handler: handlerName,
              logMode: logModes.Info,
              requestId: requestIdValue,
              relatedData: permissionSetNameValue,
              status: requestStatus.Completed,
              statusMessage: `permission Set delete operation completed`,
            },
            functionLogMode
          );
        }
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestIdValue,
            relatedData: permissionSetNameValue,
            status: requestStatus.Aborted,
            statusMessage: `permission Set delete operation ignored as no reference found`,
          },
          functionLogMode
        );
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
    } else {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestIdValue,
          relatedData: permissionSetNameValue,
          status: requestStatus.Completed,
          statusMessage: `permission Set ${message.action} operation completed - no reference found for current Item`,
        },
        functionLogMode
      );
    }
  } catch (err) {
    if (
      err instanceof DynamoDBServiceException ||
      err instanceof SNSServiceException ||
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
            permissionSetNameValue
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
          permissionSetNameValue
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
            permissionSetNameValue
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
          permissionSetNameValue
        ),
      });
    }
  }
};

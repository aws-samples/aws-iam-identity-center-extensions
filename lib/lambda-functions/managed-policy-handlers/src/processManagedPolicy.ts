/**
 * Utility function that attaches a managed Policy to permission set This
 * function is configured to be deployed in SSO account / region as state
 * machines do not yet support cross-account lambda invocations. When this
 * suppport is released, this function would be deployed in target account.
 * Additionally, we can't use cross account SNS topic as the bridging mechanism
 * because of the subsequent describe and retry calls
 */

const { AWS_REGION, functionLogMode, AWS_LAMBDA_FUNCTION_NAME } = process.env;

const ssoAdminClientObject = new SSOAdminClient({
  region: AWS_REGION,
  maxAttempts: 2,
});

import {
  AttachManagedPolicyToPermissionSetCommand,
  DetachManagedPolicyFromPermissionSetCommand,
  ListManagedPoliciesInPermissionSetCommand,
  SSOAdminClient,
  SSOAdminServiceException,
} from "@aws-sdk/client-sso-admin";
import {
  logModes,
  ManagedPolicyObjectOp,
  requestStatus,
} from "../../helpers/src/interfaces";
import {
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
let managedPolicyArn = "";

export const handler = async (event: ManagedPolicyObjectOp) => {
  logger(
    {
      handler: handlerName,
      logMode: logModes.Info,
      status: requestStatus.InProgress,
      statusMessage: `AWS IAM Identity Center managed policy processing started for operation ${event.operation} and managedPolicyArn ${event.managedPolicyArn} and permissionSetArn ${event.permissionSetArn}`,
    },
    functionLogMode
  );
  try {
    managedPolicyArn = event.managedPolicyArn;
    if (event.operation === "attach") {
      await ssoAdminClientObject.send(
        new AttachManagedPolicyToPermissionSetCommand({
          ManagedPolicyArn: event.managedPolicyArn,
          InstanceArn: event.instanceArn,
          PermissionSetArn: event.permissionSetArn,
        })
      );
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          status: requestStatus.InProgress,
          statusMessage: `Successfully attached AWS IAM Identity Center managed policy ARN ${event.managedPolicyArn} to permissionSetArn ${event.permissionSetArn}`,
        },
        functionLogMode
      );
      return {
        status: "true",
      };
    } else if (event.operation === "detach") {
      await ssoAdminClientObject.send(
        new DetachManagedPolicyFromPermissionSetCommand({
          ManagedPolicyArn: event.managedPolicyArn,
          InstanceArn: event.instanceArn,
          PermissionSetArn: event.permissionSetArn,
        })
      );
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          status: requestStatus.InProgress,
          statusMessage: `Successfully detached AWS IAM Identity Center managed policy arn ${event.managedPolicyArn} to permissionSetArn ${event.permissionSetArn}`,
        },
        functionLogMode
      );
      return {
        status: "true",
      };
    } else if (event.operation === "describe") {
      const currentManagedPoliciesList = await ssoAdminClientObject.send(
        new ListManagedPoliciesInPermissionSetCommand({
          InstanceArn: event.instanceArn,
          PermissionSetArn: event.permissionSetArn,
        })
      );
      switch (event.parentOperation) {
        case "attach":
          if (currentManagedPoliciesList.AttachedManagedPolicies) {
            const matchedManagedPolicies =
              currentManagedPoliciesList.AttachedManagedPolicies.filter(
                (managedPolicy) =>
                  managedPolicy.Arn?.toLowerCase() ===
                  event.managedPolicyArn.toLowerCase()
              );
            if (matchedManagedPolicies.length >= 1) {
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  status: requestStatus.InProgress,
                  statusMessage: `Successfully validated that AWS IAM Identity Center managed policy arn ${event.managedPolicyArn} is attached to permissionSetArn ${event.permissionSetArn}`,
                },
                functionLogMode
              );
              return {
                status: "true",
              };
            } else {
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  status: requestStatus.InProgress,
                  statusMessage: `Can not validate that AWS IAM Identity Center managed policy arn ${event.managedPolicyArn} is attached to permissionSetArn ${event.permissionSetArn}`,
                },
                functionLogMode
              );
              return {
                status: "false",
                statusReason: `Can not validate that AWS IAM Identity Center managed policy arn ${event.managedPolicyArn} is attached to permissionSetArn ${event.permissionSetArn}`,
              };
            }
          } else {
            return {
              status: "false",
              statusReason: `No customer managed policies are found for permissionSetArn ${event.permissionSetArn}`,
            };
          }
        case "detach":
          if (currentManagedPoliciesList.AttachedManagedPolicies) {
            const matchedManagedPolicies =
              currentManagedPoliciesList.AttachedManagedPolicies.filter(
                (managedPolicy) =>
                  managedPolicy.Arn?.toLowerCase() ===
                  event.managedPolicyArn.toLowerCase()
              );
            if (matchedManagedPolicies.length === 0) {
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  status: requestStatus.InProgress,
                  statusMessage: `Successfully validated that AWS IAM Identity Center managed policy arn ${event.managedPolicyArn} is detached from permissionSetArn ${event.permissionSetArn}`,
                },
                functionLogMode
              );
              return {
                status: "true",
              };
            } else {
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  status: requestStatus.InProgress,
                  statusMessage: `Can not validate that AWS IAM Identity Center managed policy arn ${event.managedPolicyArn} is detached from permissionSetArn ${event.permissionSetArn}`,
                },
                functionLogMode
              );
              return {
                status: "false",
                statusReason: `Can not validate that AWS IAM Identity Center managed policy arn ${event.managedPolicyArn} is detached from permissionSetArn ${event.permissionSetArn}`,
              };
            }
          } else {
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                status: requestStatus.InProgress,
                statusMessage: `Successfully validated that AWS IAM Identity Center managed policy arn ${event.managedPolicyArn} is detached from permissionSetArn ${event.permissionSetArn}`,
              },
              functionLogMode
            );
            return {
              status: "true",
            };
          }
        default:
          return {
            status: "false",
            statusReason: `Unknown parent op detected for describe type event`,
          };
      }
    } else {
      logger(
        {
          handler: handlerName,
          logMode: logModes.Exception,
          status: requestStatus.InProgress,
          statusMessage: `For managed policy arn ${event.managedPolicyArn} , invalid operation type specified - ${event.operation}`,
        },
        functionLogMode
      );
      return {
        status: "false",
        statusReason: `For managed policy arn ${event.managedPolicyArn} , invalid operation type specified - ${event.operation}`,
      };
    }
  } catch (error) {
    if (error instanceof SSOAdminServiceException) {
      logger({
        handler: handlerName,

        logMode: logModes.Exception,
        status: requestStatus.FailedWithException,
        statusMessage: constructExceptionMessageforLogger(
          "",
          error.name,
          error.message,
          managedPolicyArn
        ),
      });
      return {
        status: "false",
        statusReason: `SSO service exception ${error.name}`,
      };
    } else {
      logger({
        handler: handlerName,
        logMode: logModes.Exception,
        status: requestStatus.FailedWithException,
        statusMessage: constructExceptionMessageforLogger(
          "",
          "Unhandled exception",
          JSON.stringify(error),
          managedPolicyArn
        ),
      });
      return {
        status: "false",
        statusReason: `Unhandled exception`,
      };
    }
  }
};

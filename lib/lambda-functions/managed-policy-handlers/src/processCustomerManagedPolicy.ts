/**
 * Utility function that attaches a customer managed Policy to permission set
 * This function is configured to be deployed in SSO account / region as state
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
  AttachCustomerManagedPolicyReferenceToPermissionSetCommand,
  DetachCustomerManagedPolicyReferenceFromPermissionSetCommand,
  ListCustomerManagedPolicyReferencesInPermissionSetCommand,
  SSOAdminClient,
  SSOAdminServiceException,
} from "@aws-sdk/client-sso-admin";
import {
  CustomerManagedPolicyObjectOp,
  logModes,
  requestStatus,
} from "../../helpers/src/interfaces";
import {
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
let customerManagedPolicyName = "";

export const handler = async (event: CustomerManagedPolicyObjectOp) => {
  logger(
    {
      handler: handlerName,
      logMode: logModes.Info,
      status: requestStatus.InProgress,
      statusMessage: `AWS SSO customer managed policy processing started for operation ${event.operation} and customerManagedPolicyName ${event.customerManagedPolicy.Name} and permissionSetArn ${event.permissionSetArn}`,
    },
    functionLogMode
  );
  try {
    customerManagedPolicyName = event.customerManagedPolicy.Name;
    if (event.operation === "attach") {
      await ssoAdminClientObject.send(
        new AttachCustomerManagedPolicyReferenceToPermissionSetCommand({
          CustomerManagedPolicyReference: event.customerManagedPolicy,
          InstanceArn: event.instanceArn,
          PermissionSetArn: event.permissionSetArn,
        })
      );
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          status: requestStatus.InProgress,
          statusMessage: `Successfully attached AWS SSO customer managed policy ${event.customerManagedPolicy.Name} to permissionSetArn ${event.permissionSetArn}`,
        },
        functionLogMode
      );
      return {
        status: "true",
      };
    } else if (event.operation === "detach") {
      await ssoAdminClientObject.send(
        new DetachCustomerManagedPolicyReferenceFromPermissionSetCommand({
          CustomerManagedPolicyReference: event.customerManagedPolicy,
          InstanceArn: event.instanceArn,
          PermissionSetArn: event.permissionSetArn,
        })
      );
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          status: requestStatus.InProgress,
          statusMessage: `Successfully detached AWS SSO customer managed policy ${event.customerManagedPolicy.Name} to permissionSetArn ${event.permissionSetArn}`,
        },
        functionLogMode
      );
      return {
        status: "true",
      };
    } else if (event.operation === "describe") {
      const currentCustomerManagedPoliciesList =
        await ssoAdminClientObject.send(
          new ListCustomerManagedPolicyReferencesInPermissionSetCommand({
            InstanceArn: event.instanceArn,
            PermissionSetArn: event.permissionSetArn,
          })
        );
      switch (event.parentOperation) {
        case "attach":
          if (
            currentCustomerManagedPoliciesList.CustomerManagedPolicyReferences
          ) {
            const matchedCustomerManagedPolicies =
              currentCustomerManagedPoliciesList.CustomerManagedPolicyReferences.filter(
                (customerManagedPolicy) =>
                  customerManagedPolicy.Name?.toLowerCase() ===
                  event.customerManagedPolicy.Name.toLowerCase()
              );
            if (matchedCustomerManagedPolicies.length >= 1) {
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  status: requestStatus.InProgress,
                  statusMessage: `Successfully validated that AWS SSO customer managed policy ${event.customerManagedPolicy.Name} is attached to permissionSetArn ${event.permissionSetArn}`,
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
                  statusMessage: `Can not validate that AWS SSO customer managed policy ${event.customerManagedPolicy.Name} is attached to permissionSetArn ${event.permissionSetArn}`,
                },
                functionLogMode
              );
              return {
                status: "false",
                statusReason: `Can not validate that AWS SSO customer managed policy ${event.customerManagedPolicy.Name} is attached to permissionSetArn ${event.permissionSetArn}`,
              };
            }
          } else {
            return {
              status: "false",
              statusReason: `No customer managed policies are found for permissionSetArn ${event.permissionSetArn}`,
            };
          }
        case "detach":
          if (
            currentCustomerManagedPoliciesList.CustomerManagedPolicyReferences
          ) {
            const matchedCustomerManagedPolicies =
              currentCustomerManagedPoliciesList.CustomerManagedPolicyReferences.filter(
                (customerManagedPolicy) =>
                  customerManagedPolicy.Name?.toLowerCase() ===
                  event.customerManagedPolicy.Name.toLowerCase()
              );
            if (matchedCustomerManagedPolicies.length === 0) {
              logger(
                {
                  handler: handlerName,
                  logMode: logModes.Info,
                  status: requestStatus.InProgress,
                  statusMessage: `Successfully validated that AWS SSO customer managed policy ${event.customerManagedPolicy.Name} is detached from permissionSetArn ${event.permissionSetArn}`,
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
                  statusMessage: `Can not validate that AWS SSO customer managed policy ${event.customerManagedPolicy.Name} is detached from permissionSetArn ${event.permissionSetArn}`,
                },
                functionLogMode
              );
              return {
                status: "false",
                statusReason: `Can not validate that AWS SSO customer managed policy ${event.customerManagedPolicy.Name} is detached from permissionSetArn ${event.permissionSetArn}`,
              };
            }
          } else {
            logger(
              {
                handler: handlerName,
                logMode: logModes.Info,
                status: requestStatus.InProgress,
                statusMessage: `Successfully validated that AWS SSO customer managed policy ${event.customerManagedPolicy.Name} is detached from permissionSetArn ${event.permissionSetArn}`,
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
          statusMessage: `For customer managed policy ${event.customerManagedPolicy.Name} , invalid operation type specified - ${event.operation}`,
        },
        functionLogMode
      );
      return {
        status: "false",
        statusReason: `For customer managed policy ${event.customerManagedPolicy.Name} , invalid operation type specified - ${event.operation}`,
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
          customerManagedPolicyName
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
          customerManagedPolicyName
        ),
      });
      return {
        status: "false",
        statusReason: `Unhandled exception`,
      };
    }
  }
};

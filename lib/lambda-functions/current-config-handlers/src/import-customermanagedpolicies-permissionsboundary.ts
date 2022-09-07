/**
 * Function that would read and update solution persistence with customer
 * managed policies and permissions boundary
 */

const { AWS_REGION, functionLogMode, AWS_LAMBDA_FUNCTION_NAME } = process.env;

const ssoAdminClientObject = new SSOAdminClient({
  region: AWS_REGION,
  maxAttempts: 2,
});

import {
  GetPermissionsBoundaryForPermissionSetCommand,
  ListCustomerManagedPolicyReferencesInPermissionSetCommand,
  SSOAdminClient,
  SSOAdminServiceException,
} from "@aws-sdk/client-sso-admin";
import {
  DescribeCmpAndPb,
  logModes,
  requestStatus,
} from "../../helpers/src/interfaces";
import {
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
const permissionSetName = "";

export const handler = async (event: DescribeCmpAndPb) => {
  logger(
    {
      handler: handlerName,
      logMode: logModes.Info,
      status: requestStatus.InProgress,
      statusMessage: `AWS IAM Identity Center customer managed policy import started for permissionSetArn ${event.permissionSetArn}`,
    },
    functionLogMode
  );
  try {
    if (event.objectToDescribe === "customerManagedPolicy") {
      const result = await ssoAdminClientObject.send(
        new ListCustomerManagedPolicyReferencesInPermissionSetCommand({
          InstanceArn: event.instanceArn,
          PermissionSetArn: event.permissionSetArn,
          MaxResults: 10,
        })
      );
      logger({
        handler: handlerName,
        logMode: logModes.Info,
        status: requestStatus.Completed,
        statusMessage: `AWS IAM Identity Center customer managed policy import completed for permissionSetArn ${event.permissionSetArn}`,
      });
      return {
        status: "true",
        result: result,
      };
    } else if (event.objectToDescribe === "permissionsBoundary") {
      const result = await ssoAdminClientObject.send(
        new GetPermissionsBoundaryForPermissionSetCommand({
          InstanceArn: event.instanceArn,
          PermissionSetArn: event.permissionSetArn,
        })
      );
      logger({
        handler: handlerName,
        logMode: logModes.Info,
        status: requestStatus.Completed,
        statusMessage: `AWS IAM Identity Center permission boundary import completed for permissionSetArn ${event.permissionSetArn}`,
      });
      return {
        status: "true",
        result: result,
      };
    } else {
      logger({
        handler: handlerName,
        logMode: logModes.Warn,
        status: requestStatus.FailedWithError,
        statusMessage: `AWS IAM Identity Center customer managed policy/permissions boundary import completed for permissionSetArn ${event.permissionSetArn}`,
      });
      return {
        status: "false",
        statusReason: `Incorrect describeOp type specified`,
      };
    }
  } catch (error) {
    if (
      error instanceof SSOAdminServiceException &&
      error.name.toLowerCase() === "resourcenotfoundexception"
    ) {
      logger({
        handler: handlerName,
        logMode: logModes.Info,
        status: requestStatus.Completed,
        statusMessage: `AWS IAM Identity Center customer managed policy/permissions boundary import completed for permissionSetArn ${event.permissionSetArn}`,
      });
      return {
        status: "true",
        result: {},
      };
    } else if (
      error instanceof SSOAdminServiceException &&
      !(error.name.toLowerCase() === "resourcenotfoundexception")
    ) {
      {
        logger({
          handler: handlerName,

          logMode: logModes.Exception,
          status: requestStatus.FailedWithException,
          statusMessage: constructExceptionMessageforLogger(
            "",
            error.name,
            error.message,
            permissionSetName
          ),
        });
        return {
          status: "false",
          statusReason: `SSO service exception ${error.name}`,
        };
      }
    } else {
      logger({
        handler: handlerName,
        logMode: logModes.Exception,
        status: requestStatus.FailedWithException,
        statusMessage: constructExceptionMessageforLogger(
          "",
          "Unhandled exception",
          JSON.stringify(error),
          permissionSetName
        ),
      });
      return {
        status: "false",
        statusReason: `Unhandled exception`,
      };
    }
  }
};

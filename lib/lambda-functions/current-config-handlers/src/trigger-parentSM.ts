/**
 * -
 *
 * Objective: Implement custom resource that invokes importCurrentConfigSM state
 * machine in SSO account Trigger source: Cloudformation custom resource
 * provider framework
 *
 * - Invoke the state machine witht the payload
 * - If the request type is delete, we don't do anything as this is a invoke type
 *   custom resource
 */

// Lambda types import
// SDK and third party client imports
const { AWS_LAMBDA_FUNCTION_NAME } = process.env;
import {
  SFNClient,
  StartExecutionCommand,
  SFNServiceException,
} from "@aws-sdk/client-sfn";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { CloudFormationCustomResourceEvent } from "aws-lambda";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import {
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";
import { v4 as uuidv4 } from "uuid";
const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";

export const handler = async (event: CloudFormationCustomResourceEvent) => {
  const { importCurrentConfigSMArn } = event.ResourceProperties;
  const requestId = uuidv4().toString();
  try {
    const {
      smInvokeRoleArn,
      importAccountAssignmentSMArn,
      importPermissionSetSMArn,
      accountAssignmentImportTopicArn,
      permissionSetImportTopicArn,
      temporaryPermissionSetTableName,
      importCmpAndPbArn,
      ssoRegion,
    } = event.ResourceProperties;
    const sfnClientObject = new SFNClient({
      region: ssoRegion,
      credentials: fromTemporaryCredentials({
        params: {
          RoleArn: smInvokeRoleArn,
        },
      }),
      maxAttempts: 2,
    });
    const stateMachineExecution = await sfnClientObject.send(
      new StartExecutionCommand({
        stateMachineArn: importCurrentConfigSMArn,
        input: JSON.stringify({
          temporaryPermissionSetTableName: temporaryPermissionSetTableName,
          importAccountAssignmentSMArn: importAccountAssignmentSMArn,
          accountAssignmentImportTopicArn: accountAssignmentImportTopicArn,
          importPermissionSetSMArn: importPermissionSetSMArn,
          permissionSetImportTopicArn: permissionSetImportTopicArn,
          PhysicalResourceId: importCurrentConfigSMArn,
          importCmpAndPbArn: importCmpAndPbArn,
          eventType: event.RequestType,
          triggerSource: "CloudFormation",
          requestId: requestId,
          waitSeconds: 2,
          pageSize: 5,
        }),
      }),
    );
    logger({
      handler: "parentInvokeSM",
      logMode: logModes.Info,
      relatedData: `${stateMachineExecution.executionArn}`,
      requestId: requestId,
      status: requestStatus.InProgress,
      statusMessage: `Custom resource creation triggered stateMachine`,
    });
    //No status return as it would be updated by the state machine
    return {
      PhysicalResourceId: importCurrentConfigSMArn,
      stateMachineExecutionArn: stateMachineExecution.executionArn,
      requestId: requestId,
    };
  } catch (err) {
    if (err instanceof SFNServiceException) {
      logger({
        handler: handlerName,
        requestId: requestId,
        logMode: logModes.Exception,
        status: requestStatus.FailedWithException,
        statusMessage: constructExceptionMessageforLogger(
          requestId,
          err.name,
          err.message,
          "",
        ),
      });
      return {
        Status: "FAILED",
        PhysicalResourceId: importCurrentConfigSMArn,
        Reason: constructExceptionMessageforLogger(
          requestId,
          err.name,
          err.message,
          "",
        ),
      };
    } else {
      logger({
        handler: handlerName,
        requestId: requestId,
        logMode: logModes.Exception,
        status: requestStatus.FailedWithException,
        statusMessage: constructExceptionMessageforLogger(
          requestId,
          "Unhandled exception",
          JSON.stringify(err),
          "",
        ),
      });
      return {
        Status: "FAILED",
        PhysicalResourceId: importCurrentConfigSMArn,
        Reason: constructExceptionMessageforLogger(
          requestId,
          "Unhandled exception",
          JSON.stringify(err),
          "",
        ),
      };
    }
  }
};

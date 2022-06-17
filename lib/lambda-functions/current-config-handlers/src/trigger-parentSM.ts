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
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { CloudFormationCustomResourceEvent } from "aws-lambda";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";
import { v4 as uuidv4 } from "uuid";
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
          eventType: event.RequestType,
          triggerSource: "CloudFormation",
          requestId: requestId,
          waitSeconds: 2,
          pageSize: 5,
        }),
      })
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
  } catch (e) {
    logger({
      handler: "parentInvokeSM",
      logMode: logModes.Exception,
      requestId: requestId,
      relatedData: `${importCurrentConfigSMArn}`,
      status: requestStatus.FailedWithException,
      statusMessage: `Custom resource creation failed with exception: ${JSON.stringify(
        e
      )}`,
    });
    return {
      Status: "FAILED",
      PhysicalResourceId: importCurrentConfigSMArn,
      Reason: `main handler exception in invokeParentSM: ${e}`,
    };
  }
};

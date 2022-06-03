/**
 * Implements custom resource onEvent handler through CDK framework. This custom
 * resource maps to triggering the step function, by reading the resource
 * properties sent by cloudformation service, and then post triggering the state
 * machine, returns back the physical resource ID and state machine execution ARN
 */

/** Get environment variables */

const { AWS_REGION } = process.env;
/** SDK and third party client imports */
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { CloudFormationCustomResourceEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { requestStatus } from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";
/**
 * SDK and third party client instantiations done as part of init context for
 * optimisation purposes. All AWS JS SDK clients are configured with a default
 * exponential retry limit of 2
 */
const sfnClientObject = new SFNClient({
  region: AWS_REGION,
  maxAttempts: 2,
});

export const handler = async (event: CloudFormationCustomResourceEvent) => {
  /** Read the physical resource ID i.e. step function ARN */
  const { importCurrentConfigSMArn } = event.ResourceProperties;
  /** Instantiate UUID based request ID for observability */
  const requestId = uuidv4().toString();
  try {
    /**
     * Get other even resource properties that would be passed to state machine
     * for execution
     */
    const {
      importAccountAssignmentSMArn,
      importPermissionSetSMArn,
      accountAssignmentImportTopicArn,
      permissionSetImportTopicArn,
      temporaryPermissionSetTableName,
    } = event.ResourceProperties;
    /** Execute the state machine */
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
          pageSize: 1,
        }),
      })
    );
    logger({
      handler: "parentInvokeSM",
      logMode: "info",
      relatedData: `${stateMachineExecution.executionArn}`,
      requestId: requestId,
      status: requestStatus.InProgress,
      statusMessage: `Custom resource creation triggered stateMachine`,
    });
    /**
     * Return the step function execution arn, note that we don't return the
     * status here as that would be resolved by the isComplete handler
     */
    return {
      PhysicalResourceId: importCurrentConfigSMArn,
      stateMachineExecutionArn: stateMachineExecution.executionArn,
      requestId: requestId,
    };
  } catch (e) {
    logger({
      handler: "parentInvokeSM",
      logMode: "error",
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

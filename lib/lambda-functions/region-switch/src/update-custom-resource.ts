/**
 * IsComplete handler implementation for cloud formation custom resource. This
 * implementation gets a step function execution arn and is invoked multiple
 * times by CDK's custom resource framework handler where the status of the step
 * function and isComplete signal is sent back
 */
/** Get environment variables */
const { ssoRegion, ssoAccountId } = process.env;

/** SDK and third party client imports */
import { DescribeExecutionCommand, SFNClient } from "@aws-sdk/client-sfn";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import { logger, StateMachineError } from "../../helpers/src/utilities";
/**
 * SDK and third party client instantiations done as part of init context for
 * optimisation purposes. All AWS JS SDK clients are configured with a default
 * exponential retry limit of 2
 */
const sfnClientObject = new SFNClient({
  region: ssoRegion,
  maxAttempts: 2,
});

/* eslint-disable  @typescript-eslint/no-explicit-any */
export const handler = async (event: any) => {
  /** Get request ID and state machine execution arn from CloudFormation */
  const { stateMachineExecutionArn, requestId } = event;
  try {
    logger({
      handler: "updateCustomResource",
      logMode: logModes.Info,
      relatedData: `${stateMachineExecutionArn}`,
      requestId: requestId,
      status: requestStatus.InProgress,
      statusMessage: `Custom resource update - stateMachine status inquiry start`,
    });
    /** Fetch the current status of the state machine execution */
    const stateMachineExecutionResult = await sfnClientObject.send(
      new DescribeExecutionCommand({
        executionArn: stateMachineExecutionArn,
      }),
    );
    /**
     * Handle the update back to the custom resource framework based on the
     * current state machine execution status
     */

    switch (stateMachineExecutionResult.status) {
      case "RUNNING": {
        logger({
          handler: "updateCustomResource",
          logMode: logModes.Info,
          requestId: requestId,
          relatedData: `${stateMachineExecutionArn}`,
          status: requestStatus.InProgress,
          statusMessage: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} still running`,
        });
        return {
          IsComplete: false,
        };
      }
      case "SUCCEEDED": {
        logger({
          handler: "updateCustomResource",
          logMode: logModes.Info,
          requestId: requestId,
          relatedData: `${stateMachineExecutionArn}`,
          status: requestStatus.Completed,
          statusMessage: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} complete`,
        });
        return {
          IsComplete: true,
        };
      }
      case "FAILED": {
        logger({
          handler: "updateCustomResource",
          logMode: logModes.Exception,
          requestId: requestId,
          relatedData: `${stateMachineExecutionArn}`,
          status: requestStatus.FailedWithError,
          statusMessage: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} failed with error. See error details in ${ssoAccountId} account, ${ssoRegion} region`,
        });
        throw new StateMachineError({
          message: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} failed with error. See error details in ${ssoAccountId} account, ${ssoRegion} region`,
        });
      }
      case "TIMED_OUT": {
        logger({
          handler: "updateCustomResource",
          logMode: logModes.Exception,
          requestId: requestId,
          relatedData: `${stateMachineExecutionArn}`,
          status: requestStatus.FailedWithError,
          statusMessage: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} timed out. See timeout details in ${ssoAccountId} account, ${ssoRegion} region`,
        });
        throw new StateMachineError({
          message: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} timed out. See timeout details in ${ssoAccountId} account, ${ssoRegion} region`,
        });
      }
      default: {
        logger({
          handler: "updateCustomResource",
          logMode: logModes.Exception,
          relatedData: `${stateMachineExecutionArn}`,
          status: requestStatus.FailedWithError,
          statusMessage: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} reached an unknown status. See details in ${ssoAccountId} account, ${ssoRegion} region`,
        });
        throw new StateMachineError({
          message: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} reached an unknown status. See details in ${ssoAccountId} account, ${ssoRegion} region`,
        });
      }
    }
  } catch (e) {
    if (e instanceof StateMachineError) {
      throw e;
    } else {
      logger({
        handler: "updateCustomResource",
        logMode: logModes.Exception,
        requestId: requestId,
        relatedData: `${stateMachineExecutionArn}`,
        status: requestStatus.FailedWithException,
        statusMessage: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} failed with exception: ${JSON.stringify(
          e,
        )}`,
      });
      throw new Error(
        `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} failed with exception: ${JSON.stringify(
          e,
        )}`,
      );
    }
  }
};

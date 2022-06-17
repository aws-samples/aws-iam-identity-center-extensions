/** Objective: Update cloudformation with custom resource status */
const { AWS_REGION } = process.env;

// Lambda types import
// SDK and third party client imports
import { DescribeExecutionCommand, SFNClient } from "@aws-sdk/client-sfn";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import { logger, StateMachineError } from "../../helpers/src/utilities";

const sfnClientObject = new SFNClient({
  region: AWS_REGION,
  maxAttempts: 2,
});

/* eslint-disable  @typescript-eslint/no-explicit-any */
export const handler = async (event: any) => {
  //event is of any type and not CloudFormationCustomResource as it does not allow state to be passed between onEvent and isComplete handlers
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
    const stateMachineExecutionResult = await sfnClientObject.send(
      new DescribeExecutionCommand({
        executionArn: stateMachineExecutionArn,
      })
    );

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
          statusMessage: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} failed with error.`,
        });
        throw new StateMachineError({
          message: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} failed with error.`,
        });
      }
      case "TIMED_OUT": {
        logger({
          handler: "updateCustomResource",
          logMode: logModes.Exception,
          requestId: requestId,
          relatedData: `${stateMachineExecutionArn}`,
          status: requestStatus.FailedWithError,
          statusMessage: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} timed out.`,
        });
        throw new StateMachineError({
          message: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} timed out.`,
        });
      }
      default: {
        logger({
          handler: "updateCustomResource",
          logMode: logModes.Exception,
          relatedData: `${stateMachineExecutionArn}`,
          status: requestStatus.FailedWithError,
          statusMessage: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} reached an unknown status.`,
        });
        throw new StateMachineError({
          message: `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} reached an unknown status.`,
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
          e
        )}`,
      });
      throw new Error(
        `Custom resource update - stateMachine with execution arn: ${stateMachineExecutionArn} failed with exception: ${JSON.stringify(
          e
        )}`
      );
    }
  }
};

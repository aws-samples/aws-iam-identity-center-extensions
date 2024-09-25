/** Objective: Update cloudformation with custom resource status */
const { smDescribeRoleArn, ssoRegion, ssoAccountId, AWS_LAMBDA_FUNCTION_NAME } =
  process.env;

// Lambda types import
// SDK and third party client imports
import {
  DescribeExecutionCommand,
  SFNClient,
  SFNServiceException,
} from "@aws-sdk/client-sfn";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import {
  constructExceptionMessageforLogger,
  logger,
  StateMachineError,
} from "../../helpers/src/utilities";

const sfnClientObject = new SFNClient({
  region: ssoRegion,
  credentials: fromTemporaryCredentials({
    params: {
      RoleArn: smDescribeRoleArn,
    },
  }),
  maxAttempts: 2,
});
const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
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
      }),
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
  } catch (err) {
    if (err instanceof StateMachineError) {
      throw err;
    } else if (err instanceof SFNServiceException) {
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
      throw err;
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
      throw err;
    }
  }
};

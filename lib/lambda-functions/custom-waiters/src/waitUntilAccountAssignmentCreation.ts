/** Objective: Custom waiter for account assignment creation */

import {
  DescribeAccountAssignmentCreationStatusCommand,
  DescribeAccountAssignmentCreationStatusCommandInput,
  DescribeAccountAssignmentCreationStatusCommandOutput,
  SSOAdminClient,
  StatusValues,
  SSOAdminServiceException,
} from "@aws-sdk/client-sso-admin";
import {
  checkExceptions,
  createWaiter,
  WaiterConfiguration,
  WaiterResult,
  WaiterState,
} from "@aws-sdk/util-waiter";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";

const checkState = async (
  client: SSOAdminClient,
  input: DescribeAccountAssignmentCreationStatusCommandInput,
): Promise<WaiterResult> => {
  let reason;
  try {
    const result: DescribeAccountAssignmentCreationStatusCommandOutput =
      await client.send(
        new DescribeAccountAssignmentCreationStatusCommand(input),
      );
    reason = result;
    if (
      result.AccountAssignmentCreationStatus?.Status === StatusValues.SUCCEEDED
    ) {
      return { state: WaiterState.SUCCESS, reason };
    } else {
      return { state: WaiterState.RETRY, reason };
    }
  } catch (exception) {
    if (exception instanceof SSOAdminServiceException) {
      reason = exception.message;
      return { state: WaiterState.FAILURE, reason };
    } else {
      reason = exception;
      return { state: WaiterState.FAILURE, reason };
    }
  }
};

export const waitUntilAccountAssignmentCreation = async (
  params: WaiterConfiguration<SSOAdminClient>,
  input: DescribeAccountAssignmentCreationStatusCommandInput,
  requestId: string,
  functionLogMode: string,
): Promise<WaiterResult> => {
  logger(
    {
      handler: "accountAssignmentCreationWaiter",
      logMode: logModes.Debug,
      requestId: requestId,
      relatedData: `${input.AccountAssignmentCreationRequestId}`,
      status: requestStatus.InProgress,
      statusMessage: `Setting service defaults`,
    },
    functionLogMode,
  );
  const serviceDefaults = { minDelay: 60, maxDelay: 120 };
  logger(
    {
      handler: "accountAssignmentCreationWaiter",
      logMode: logModes.Info,
      requestId: requestId,
      relatedData: `${input.AccountAssignmentCreationRequestId}`,
      status: requestStatus.InProgress,
      statusMessage: `Invoking waiter for createAccountAssignment operation`,
    },
    functionLogMode,
  );
  const result = await createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState,
  );
  logger(
    {
      handler: "accountAssignmentCreationWaiter",
      logMode: logModes.Info,
      requestId: requestId,
      relatedData: `${input.AccountAssignmentCreationRequestId}`,
      status: requestStatus.InProgress,
      statusMessage: `Waiter completed with result: ${JSON.stringify(result)}`,
    },
    functionLogMode,
  );
  return checkExceptions(result);
};

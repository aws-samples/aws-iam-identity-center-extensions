/** Objective: Custom waiter for account assignment creation */

import {
  DescribeAccountAssignmentCreationStatusCommand,
  DescribeAccountAssignmentCreationStatusCommandInput,
  DescribeAccountAssignmentCreationStatusCommandOutput,
  SSOAdminClient,
  StatusValues,
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
  input: DescribeAccountAssignmentCreationStatusCommandInput
): Promise<WaiterResult> => {
  let reason;
  try {
    const result: DescribeAccountAssignmentCreationStatusCommandOutput =
      await client.send(
        new DescribeAccountAssignmentCreationStatusCommand(input)
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
    reason = exception;
    return { state: WaiterState.FAILURE, reason };
  }
};

export const waitUntilAccountAssignmentCreation = async (
  params: WaiterConfiguration<SSOAdminClient>,
  input: DescribeAccountAssignmentCreationStatusCommandInput,
  requestId: string
): Promise<WaiterResult> => {
  logger({
    handler: "accountAssignmentCreationWaiter",
    logMode: logModes.Info,
    relatedData: `${input.AccountAssignmentCreationRequestId}`,
    requestId: requestId,
    status: requestStatus.InProgress,
    statusMessage: `Waiter invoked for createAccountAssignment Operation`,
  });
  const serviceDefaults = { minDelay: 60, maxDelay: 120 };
  const result = await createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState
  );
  logger({
    handler: "accountAssignmentCreationWaiter",
    logMode: logModes.Info,
    relatedData: `${input.AccountAssignmentCreationRequestId}`,
    requestId: requestId,
    status: requestStatus.Completed,
    statusMessage: `Waiter Completed with result: ${JSON.stringify(result)}`,
  });
  return checkExceptions(result);
};

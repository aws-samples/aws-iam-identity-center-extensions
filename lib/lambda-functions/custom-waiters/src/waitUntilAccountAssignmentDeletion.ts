import {
  DescribeAccountAssignmentDeletionStatusCommand,
  DescribeAccountAssignmentDeletionStatusCommandInput,
  DescribeAccountAssignmentDeletionStatusCommandOutput,
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
import { requestStatus } from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";

const checkState = async (
  client: SSOAdminClient,
  input: DescribeAccountAssignmentDeletionStatusCommandInput
): Promise<WaiterResult> => {
  let reason;
  try {
    const result: DescribeAccountAssignmentDeletionStatusCommandOutput =
      await client.send(
        new DescribeAccountAssignmentDeletionStatusCommand(input)
      );
    reason = result;
    if (
      result.AccountAssignmentDeletionStatus?.Status === StatusValues.SUCCEEDED
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

export const waitUntilAccountAssignmentDeletion = async (
  params: WaiterConfiguration<SSOAdminClient>,
  input: DescribeAccountAssignmentDeletionStatusCommandInput,
  requestId: string
): Promise<WaiterResult> => {
  logger({
    handler: "accountAssignmentDeletionWaiter",
    logMode: "info",
    relatedData: `${input.AccountAssignmentDeletionRequestId}`,
    requestId: requestId,
    status: requestStatus.InProgress,
    statusMessage: `Waiter invoked for deleteAccountAssignment Operation`,
  });
  const serviceDefaults = { minDelay: 1, maxDelay: 5 };
  const result = await createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState
  );
  logger({
    handler: "accountAssignmentDeletionWaiter",
    logMode: "info",
    relatedData: `${input.AccountAssignmentDeletionRequestId}`,
    requestId: requestId,
    status: requestStatus.Completed,
    statusMessage: `Waiter Completed with result: ${JSON.stringify(result)}`,
  });
  return checkExceptions(result);
};

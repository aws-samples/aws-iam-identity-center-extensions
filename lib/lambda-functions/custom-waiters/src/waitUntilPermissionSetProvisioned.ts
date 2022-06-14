/** Objective: Custom waiter for permission set provisioning status */
import {
  DescribePermissionSetProvisioningStatusCommand,
  DescribePermissionSetProvisioningStatusCommandInput,
  DescribePermissionSetProvisioningStatusCommandOutput,
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
  input: DescribePermissionSetProvisioningStatusCommandInput
): Promise<WaiterResult> => {
  let reason;
  try {
    const result: DescribePermissionSetProvisioningStatusCommandOutput =
      await client.send(
        new DescribePermissionSetProvisioningStatusCommand(input)
      );
    reason = result;
    if (
      result.PermissionSetProvisioningStatus?.Status === StatusValues.SUCCEEDED
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

export const waitUntilPermissionSetProvisioned = async (
  params: WaiterConfiguration<SSOAdminClient>,
  input: DescribePermissionSetProvisioningStatusCommandInput,
  requestId: string
): Promise<WaiterResult> => {
  logger({
    handler: "permissionSetProvisioningWaiter",
    logMode: "info",
    relatedData: `${input.ProvisionPermissionSetRequestId}`,
    requestId: requestId,
    status: requestStatus.InProgress,
    statusMessage: `Waiter invoked for permissionSetProvisioned Operation`,
  });
  const serviceDefaults = { minDelay: 1, maxDelay: 5 };
  const result = await createWaiter(
    { ...serviceDefaults, ...params },
    input,
    checkState
  );
  logger({
    handler: "permissionSetProvisioningWaiter",
    logMode: "info",
    relatedData: `${input.ProvisionPermissionSetRequestId}`,
    requestId: requestId,
    status: requestStatus.Completed,
    statusMessage: `Waiter Completed with result: ${JSON.stringify(result)}`,
  });
  return checkExceptions(result);
};

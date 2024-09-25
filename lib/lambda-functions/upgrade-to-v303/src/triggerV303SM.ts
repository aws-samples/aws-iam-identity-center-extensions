/**
 * Objective: Implement custom resource that invokes upgrade V303 state machine
 * in target account Trigger source: Cloudformation custom resource provider
 * framework
 *
 * - Invoke the state machine witht the payload
 * - If the request type is delete, we don't do anything as this is a invoke type
 *   custom resource
 */
const { AWS_REGION } = process.env;

// Lambda types import
// SDK and third party client imports
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { CloudFormationCustomResourceEvent } from "aws-lambda";
import { v4 as uuidv4 } from "uuid";
import { logModes, requestStatus } from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";

const sfnClientObject = new SFNClient({
  region: AWS_REGION,
  maxAttempts: 2,
});

export const handler = async (event: CloudFormationCustomResourceEvent) => {
  const { upgradeV303SMArn } = event.ResourceProperties;
  const requestId = uuidv4().toString();
  try {
    const { artefactsBucketName, linksTableName, processLinksFunctionName } =
      event.ResourceProperties;

    const stateMachineExecution = await sfnClientObject.send(
      new StartExecutionCommand({
        stateMachineArn: upgradeV303SMArn,
        input: JSON.stringify({
          artefactsBucketName: artefactsBucketName,
          linksTableName: linksTableName,
          processLinksFunctionName: processLinksFunctionName,
          eventType: event.RequestType,
        }),
      }),
    );
    logger({
      handler: "upgradeSM",
      logMode: logModes.Info,
      relatedData: `${stateMachineExecution.executionArn}`,
      requestId: requestId,
      status: requestStatus.InProgress,
      statusMessage: `Custom resource creation triggered stateMachine`,
    });
    //No status return as it would be updated by the state machine
    return {
      PhysicalResourceId: upgradeV303SMArn,
      stateMachineExecutionArn: stateMachineExecution.executionArn,
      requestId: requestId,
    };
  } catch (e) {
    logger({
      handler: "upgradeSM",
      logMode: logModes.Exception,
      requestId: requestId,
      relatedData: `${upgradeV303SMArn}`,
      status: requestStatus.FailedWithException,
      statusMessage: `Custom resource creation failed with exception: ${JSON.stringify(
        e,
      )}`,
    });
    return {
      Status: "FAILED",
      PhysicalResourceId: upgradeV303SMArn,
      Reason: `main handler exception in invokeParentSM: ${e}`,
    };
  }
};

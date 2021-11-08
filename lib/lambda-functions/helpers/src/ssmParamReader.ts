/*
Objective: Implement custom SSM param reader resource
           to facilitate cross acccount access
Trigger source: Cloudformation custom resource provider
                framework
- Get param name, region, account
  and role that has permissions to read the parameter
- assume the param reader role
- read the parameter
- send the parameter value as part of response payload
- If the request type is delete, we don't do anything
  as this is a reader type custom resource
*/

// Lambda types import
import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceResponse,
} from "aws-lambda";

// SDK and third party client imports
import { SSMClient, GetParameterCommand } from "@aws-sdk/client-ssm";
import { fromTemporaryCredentials } from "@aws-sdk/credential-providers";
export const handler = async (
  event: CloudFormationCustomResourceEvent
): Promise<CloudFormationCustomResourceResponse> => {
  if (event.ResourceType !== "Delete") {
    try {
      const { paramReaderRoleArn, paramName, paramRegion, paramAccount } =
        event.ResourceProperties;

      const ssmClientObject = new SSMClient({
        region: paramRegion,
        credentials: fromTemporaryCredentials({
          params: {
            RoleArn: paramReaderRoleArn,
          },
        }),
      });

      const parameterValue = await ssmClientObject.send(
        new GetParameterCommand({
          Name: paramName,
        })
      );

      return {
        PhysicalResourceId: `arn:aws:ssm:${paramRegion}:${paramAccount}:parameter/${paramName}`,
        Data: {
          ParamValue: parameterValue.Parameter?.Value,
        },
        Status: "SUCCESS",
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
      };
    } catch (e) {
      console.error("main handler exception in ssmParamReader: ", e);
      return {
        Status: "FAILED",
        PhysicalResourceId: `arn:aws:ssm:${event.ResourceProperties.paramRegion}:${event.ResourceProperties.paramAccount}:parameter/${event.ResourceProperties.paramName}`,
        Reason: `main handler exception in ssmParamReader: ${e}`,
        StackId: event.StackId,
        RequestId: event.RequestId,
        LogicalResourceId: event.LogicalResourceId,
      };
    }
  } else {
    return {
      Status: "SUCCESS",
      PhysicalResourceId: `arn:aws:ssm:${event.ResourceProperties.paramRegion}:${event.ResourceProperties.paramAccount}:parameter/${event.ResourceProperties.paramName}`,
      StackId: event.StackId,
      RequestId: event.RequestId,
      LogicalResourceId: event.LogicalResourceId,
    };
  }
};

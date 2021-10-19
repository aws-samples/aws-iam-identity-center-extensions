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

// SDK and third party client imports
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { fromTemporaryCredentials } = require('@aws-sdk/credential-providers');

exports.handler = async (event) => {
  if (event.RequestType !== 'Delete') {
    try {
      const {
        paramReaderRoleArn, paramName, paramRegion, paramAccount,
      } = event.ResourceProperties;

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
        }),
      );

      return {
        PhysicalResourceId: `arn:aws:ssm:${paramRegion}:${paramAccount}:parameter/${paramName}`,
        Data: {
          ParamValue: parameterValue.Parameter.Value,
        },
      };
    } catch (e) {
      console.error('main handler exception in ssmParamReader: ', e);
      throw e;
    }
  } else {
    return null;
  }
};

/*
Proxy API construct that sets up
the required access for the API and lambda handler as well
as implementation of CORS override so that a lambda error is
gracefully handled by the proxy API
*/

import {
  AccessLogFormat,
  AuthorizationType,
  IResource,
  LambdaIntegration,
  LambdaRestApi,
  LogGroupLogDestination,
  MockIntegration,
  PassthroughBehavior,
  ResponseType,
} from "@aws-cdk/aws-apigateway";
import { Effect, IRole, PolicyStatement, Role } from "@aws-cdk/aws-iam";
import { Function } from "@aws-cdk/aws-lambda";
import { LogGroup, RetentionDays } from "@aws-cdk/aws-logs";
import { CfnOutput, Construct } from "@aws-cdk/core";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface LambdaProxyAPIProps {
  apiNameKey: string;
  apiResourceName: string;
  proxyfunction: Function;
  apiCallerRoleArn: string;
  methodtype: string;
  apiEndPointReaderAccountID: string;
}

export class LambdaProxyAPI extends Construct {
  public readonly lambdaProxyAPILogGroup: LogGroup;
  public readonly lambdaProxyAPI: LambdaRestApi;
  public readonly lambdaProxyAPIRole: IRole;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    lambdaProxyAPIProps: LambdaProxyAPIProps
  ) {
    super(scope, id);

    this.lambdaProxyAPILogGroup = new LogGroup(
      this,
      name(buildConfig, `${lambdaProxyAPIProps.apiNameKey}-logGroup`),
      {
        logGroupName: name(
          buildConfig,
          `${lambdaProxyAPIProps.apiNameKey}-logGroup`
        ),
        retention: RetentionDays.ONE_MONTH,
      }
    );

    this.lambdaProxyAPI = new LambdaRestApi(
      this,
      name(buildConfig, lambdaProxyAPIProps.apiNameKey),
      {
        handler: lambdaProxyAPIProps.proxyfunction,
        restApiName: name(buildConfig, lambdaProxyAPIProps.apiNameKey),
        proxy: false,
        deployOptions: {
          accessLogDestination: new LogGroupLogDestination(
            this.lambdaProxyAPILogGroup
          ),
          accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
        },
      }
    );

    new CfnOutput(
      this,
      name(buildConfig, `${lambdaProxyAPIProps.apiNameKey}-endpointURL`),
      {
        exportName: name(
          buildConfig,
          `${lambdaProxyAPIProps.apiNameKey}-endpointURL`
        ),
        value: this.lambdaProxyAPI.url,
      }
    );

    this.lambdaProxyAPI.addGatewayResponse("not_authorized", {
      type: ResponseType.DEFAULT_4XX,
      responseHeaders: {
        "Access-Control-Allow-Origin": "'*'",
        "Access-Control-Allow-Headers": "'*'",
        "Access-Control-Allow-Credentials": "'true'",
      },
      templates: {
        "application/json":
          '{ "message": $context.error.messageString, "type": "$context.error.responseType", "code": "$context.error.responseType" }',
      },
    });

    const lambdaproxyAPIResource = this.lambdaProxyAPI.root.addResource(
      lambdaProxyAPIProps.apiResourceName
    );

    addCorsOptions(lambdaproxyAPIResource);

    this.lambdaProxyAPIRole = Role.fromRoleArn(
      this,
      name(buildConfig, "importedPermissionSetRole"),
      lambdaProxyAPIProps.apiCallerRoleArn
    );

    const lambdaProxyAPIIntegration = new LambdaIntegration(
      lambdaProxyAPIProps.proxyfunction
    );

    const lambdaProxyAPIMethod = lambdaproxyAPIResource.addMethod(
      lambdaProxyAPIProps.methodtype,
      lambdaProxyAPIIntegration,
      {
        authorizationType: AuthorizationType.IAM,
      }
    );

    this.lambdaProxyAPIRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["execute-api:Invoke"],
        effect: Effect.ALLOW,
        resources: [lambdaProxyAPIMethod.methodArn],
      })
    );

    function addCorsOptions(apiResource: IResource) {
      apiResource.addMethod(
        "OPTIONS",
        new MockIntegration({
          integrationResponses: [
            {
              statusCode: "200",
              responseParameters: {
                "method.response.header.Access-Control-Allow-Headers":
                  "'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'",
                "method.response.header.Access-Control-Allow-Origin": "'*'",
                "method.response.header.Access-Control-Allow-Credentials":
                  "'false'",
                "method.response.header.Access-Control-Allow-Methods":
                  "'POST,OPTIONS'",
              },
            },
          ],
          passthroughBehavior: PassthroughBehavior.WHEN_NO_MATCH,
          requestTemplates: {
            "application/json": '{"statusCode": 200}',
          },
        }),
        {
          methodResponses: [
            {
              statusCode: "200",
              responseParameters: {
                "method.response.header.Access-Control-Allow-Headers": true,
                "method.response.header.Access-Control-Allow-Methods": true,
                "method.response.header.Access-Control-Allow-Credentials": true,
                "method.response.header.Access-Control-Allow-Origin": true,
              },
            },
          ],
        }
      );
    }
  }
}

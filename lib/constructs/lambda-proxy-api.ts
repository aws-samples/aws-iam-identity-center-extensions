/**
 * Proxy API construct that sets up the required access for the API and lambda
 * handler as well as implementation of CORS override so that a lambda error is
 * gracefully handled by the proxy API
 */

import {
  AccessLogFormat,
  AuthorizationType,
  LambdaIntegration,
  LambdaRestApi,
  LogGroupLogDestination,
} from "aws-cdk-lib/aws-apigateway";
import {
  AnyPrincipal,
  ArnPrincipal,
  Effect,
  IRole,
  PolicyDocument,
  PolicyStatement,
  Role,
} from "aws-cdk-lib/aws-iam";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";
import { name } from "./helpers";

export interface LambdaProxyAPIProps {
  apiNameKey: string;
  apiResourceName: string;
  proxyfunction: NodejsFunction;
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
    lambdaProxyAPIProps: LambdaProxyAPIProps,
  ) {
    super(scope, id);

    this.lambdaProxyAPILogGroup = new LogGroup(
      this,
      name(buildConfig, `${lambdaProxyAPIProps.apiNameKey}-logGroup`),
      {
        retention: RetentionDays.ONE_MONTH,
      },
    );

    /**
     * Restrict invoke to the configured caller role. The explicit Deny is
     * required because same-account IAM auth evaluates identity and resource
     * policies as a union, so an Allow alone would not block a principal that
     * already holds a generic execute-api:Invoke.
     */
    const apiResourcePolicy = new PolicyDocument({
      statements: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          principals: [new ArnPrincipal(lambdaProxyAPIProps.apiCallerRoleArn)],
          actions: ["execute-api:Invoke"],
          resources: ["execute-api:/*"],
        }),
        new PolicyStatement({
          effect: Effect.DENY,
          principals: [new AnyPrincipal()],
          actions: ["execute-api:Invoke"],
          resources: ["execute-api:/*"],
          conditions: {
            StringNotEquals: {
              "aws:PrincipalArn": lambdaProxyAPIProps.apiCallerRoleArn,
            },
          },
        }),
      ],
    });

    this.lambdaProxyAPI = new LambdaRestApi(
      this,
      name(buildConfig, lambdaProxyAPIProps.apiNameKey),
      {
        handler: lambdaProxyAPIProps.proxyfunction,
        restApiName: name(buildConfig, lambdaProxyAPIProps.apiNameKey),
        proxy: false,
        policy: apiResourcePolicy,
        deployOptions: {
          accessLogDestination: new LogGroupLogDestination(
            this.lambdaProxyAPILogGroup,
          ),
          accessLogFormat: AccessLogFormat.jsonWithStandardFields(),
        },
      },
    );

    new CfnOutput(
      this,
      name(buildConfig, `${lambdaProxyAPIProps.apiNameKey}-endpointURL`),
      {
        exportName: name(
          buildConfig,
          `${lambdaProxyAPIProps.apiNameKey}-endpointURL`,
        ),
        value: this.lambdaProxyAPI.url,
      },
    );

    const lambdaproxyAPIResource = this.lambdaProxyAPI.root.addResource(
      lambdaProxyAPIProps.apiResourceName,
    );

    this.lambdaProxyAPIRole = Role.fromRoleArn(
      this,
      name(buildConfig, "importedPermissionSetRole"),
      lambdaProxyAPIProps.apiCallerRoleArn,
    );

    const lambdaProxyAPIIntegration = new LambdaIntegration(
      lambdaProxyAPIProps.proxyfunction,
    );

    const lambdaProxyAPIMethod = lambdaproxyAPIResource.addMethod(
      lambdaProxyAPIProps.methodtype,
      lambdaProxyAPIIntegration,
      {
        authorizationType: AuthorizationType.IAM,
      },
    );

    this.lambdaProxyAPIRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["execute-api:Invoke"],
        effect: Effect.ALLOW,
        resources: [lambdaProxyAPIMethod.methodArn],
      }),
    );
  }
}

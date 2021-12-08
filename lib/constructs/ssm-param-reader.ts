/*
Custom cloudformation resource construct that 
allows cross account read of SSM parameter value
*/

import { CustomResource } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { ILayerVersion, Runtime } from "aws-cdk-lib/aws-lambda"; // Importing external resources in CDK would use interfaces and not base objects
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface SSMParamReaderProps {
  readonly ParamNameKey: string;
  readonly ParamAccountId: string;
  readonly ParamRegion: string;
  readonly LambdaLayers: ILayerVersion;
}

export class SSMParamReader extends Construct {
  public readonly paramValue: string;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    ssmParamReaderprops: SSMParamReaderProps
  ) {
    super(scope, id);

    const paramReadPolicy = new PolicyStatement({
      resources: [
        `arn:aws:ssm:${ssmParamReaderprops.ParamRegion}:${ssmParamReaderprops.ParamAccountId}:parameter/${ssmParamReaderprops.ParamNameKey}*`,
      ],
      actions: ["ssm:GetParameter*", "ssm:DescribeParameter*"],
    });

    const fullParamName = name(buildConfig, ssmParamReaderprops.ParamNameKey);

    const assumeRolePolicy = new PolicyStatement({
      resources: [
        `arn:aws:iam::${ssmParamReaderprops.ParamAccountId}:role/${fullParamName}-readerRole`,
      ],
      actions: ["sts:AssumeRole"],
    });

    const paramReaderFn = new NodejsFunction(
      this,
      name(buildConfig, `paramReader-${ssmParamReaderprops.ParamNameKey}`),
      {
        runtime: Runtime.NODEJS_14_X,
        functionName: name(
          buildConfig,
          `paramReader-${ssmParamReaderprops.ParamNameKey}`
        ),
        layers: [ssmParamReaderprops.LambdaLayers],
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "helpers",
          "src",
          "ssmParamReader.ts"
        ),
        bundling: {
          externalModules: [
            "@aws-sdk/client-ssm",
            "@aws-sdk/credential-providers",
          ],
          minify: true,
        },
      }
    );

    if (paramReaderFn.role) {
      paramReaderFn.role.addToPrincipalPolicy(paramReadPolicy);
      paramReaderFn.role.addToPrincipalPolicy(assumeRolePolicy);
    }

    const paramReadResourceProvider = new Provider(
      this,
      name(buildConfig, "paramReaderRP"),
      {
        onEventHandler: paramReaderFn,
      }
    );

    const paramReadResource = new CustomResource(
      this,
      name(buildConfig, "paramReadResource"),
      {
        serviceToken: paramReadResourceProvider.serviceToken,
        properties: {
          paramReaderRoleArn: `arn:aws:iam::${ssmParamReaderprops.ParamAccountId}:role/${fullParamName}-readerRole`,
          paramName: name(buildConfig, ssmParamReaderprops.ParamNameKey),
          paramRegion: ssmParamReaderprops.ParamRegion,
          paramAccount: ssmParamReaderprops.ParamAccountId,
        },
      }
    );

    this.paramValue = paramReadResource.getAtt("ParamValue").toString();
  }
}

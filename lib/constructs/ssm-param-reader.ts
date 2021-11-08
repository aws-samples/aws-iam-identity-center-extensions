/*
Custom cloudformation resource construct that 
allows cross account read of SSM parameter value
*/

import { PolicyStatement } from "@aws-cdk/aws-iam";
import * as lambda from "@aws-cdk/aws-lambda"; //Needed to avoid semgrep throwing up https://cwe.mitre.org/data/definitions/95.html
import { LayerVersion } from "@aws-cdk/aws-lambda";
import { NodejsFunction } from "@aws-cdk/aws-lambda-nodejs";
import { Construct, CustomResource } from "@aws-cdk/core";
import { Provider } from "@aws-cdk/custom-resources";
import * as Path from "path";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface SSMParamReaderProps {
  readonly ParamNameKey: string;
  readonly ParamAccountId: string;
  readonly ParamRegion: string;
  readonly LambdaLayers: LayerVersion;
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
        runtime: lambda.Runtime.NODEJS_14_X,
        functionName: name(
          buildConfig,
          `paramReader-${ssmParamReaderprops.ParamNameKey}`
        ),
        layers: [ssmParamReaderprops.LambdaLayers],
        entry: Path.join(
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

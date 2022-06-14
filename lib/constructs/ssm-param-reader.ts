/**
 * Custom cloudformation resource construct that allows cross account/cross
 * region read of SSM parameter value
 */

import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";
import { v4 as uuidv4 } from "uuid";
import { name } from "./helpers";

const generateRandomString = uuidv4().toString().split("-")[0];

export interface SSMParamReaderProps {
  readonly ParamNameKey: string;
  readonly ParamAccountId: string;
  readonly ParamRegion: string;
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

    const fullParamName = name(buildConfig, ssmParamReaderprops.ParamNameKey);
    const paramReaderRole = `arn:aws:iam::${ssmParamReaderprops.ParamAccountId}:role/${fullParamName}-readerRole`;

    const assumeRolePolicy = new PolicyStatement({
      resources: [paramReaderRole],
      actions: ["sts:AssumeRole"],
    });

    const paramReadResource = new AwsCustomResource(
      this,
      name(buildConfig, `${id.slice(id.length - 5)}-paramReadResource`),
      {
        onUpdate: {
          service: "SSM",
          action: "getParameter",
          parameters: {
            Name: fullParamName,
          },
          physicalResourceId: PhysicalResourceId.of(generateRandomString),
          region: ssmParamReaderprops.ParamRegion,
          assumedRoleArn: paramReaderRole,
        },
        policy: AwsCustomResourcePolicy.fromStatements([assumeRolePolicy]),
      }
    );

    this.paramValue = paramReadResource
      .getResponseField("Parameter.Value")
      .toString();
  }
}

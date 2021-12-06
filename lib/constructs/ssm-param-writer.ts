/*
Custom SSM writer construct that facilitates
cross account reading through the SSMParamReader
construct
*/

import { AccountPrincipal, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface SSMParamWriterProps {
  readonly ParamNameKey: string;
  readonly ParamValue: string;
  readonly ReaderAccountId: string;
}

export class SSMParamWriter extends Construct {
  public readonly parameter: StringParameter;
  public readonly parameterReaderRole: Role;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    ssmParamWriterProps: SSMParamWriterProps
  ) {
    super(scope, id);

    this.parameter = new StringParameter(
      this,
      name(buildConfig, ssmParamWriterProps.ParamNameKey),
      {
        parameterName: name(buildConfig, ssmParamWriterProps.ParamNameKey),
        stringValue: ssmParamWriterProps.ParamValue,
      }
    );

    this.parameterReaderRole = new Role(
      this,
      name(buildConfig, `${ssmParamWriterProps.ParamNameKey}-readerRole`),
      {
        roleName: name(
          buildConfig,
          `${ssmParamWriterProps.ParamNameKey}-readerRole`
        ),
        assumedBy: new AccountPrincipal(ssmParamWriterProps.ReaderAccountId),
      }
    );

    this.parameterReaderRole.addToPrincipalPolicy(
      new PolicyStatement({
        resources: [this.parameter.parameterArn],
        actions: ["ssm:GetParameter*", "ssm:DescribeParameter*"],
      })
    );
  }
}

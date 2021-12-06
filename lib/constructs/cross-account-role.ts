/*
Cross account role construct that sets
policy document,assume role account details as received in
props and also creates a parameter using the SSMParamWriter
construct and value set to rolearn 
*/

import { AccountPrincipal, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";
import { SSMParamWriter } from "./ssm-param-writer";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface CrossAccountRoleProps {
  readonly assumeAccountID: string;
  readonly roleNameKey: string;
  readonly policyStatement: PolicyStatement;
}

export class CrossAccountRole extends Construct {
  public readonly role: Role;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    crossAccountRoleProps: CrossAccountRoleProps
  ) {
    super(scope, id);

    this.role = new Role(
      this,
      name(buildConfig, `${crossAccountRoleProps.roleNameKey}-role`),
      {
        assumedBy: new AccountPrincipal(crossAccountRoleProps.assumeAccountID),
      }
    );

    this.role.addToPrincipalPolicy(crossAccountRoleProps.policyStatement);

    new SSMParamWriter(
      this,
      name(buildConfig, `${crossAccountRoleProps.roleNameKey}-roleArn`),
      buildConfig,
      {
        ParamNameKey: `${crossAccountRoleProps.roleNameKey}-roleArn`,
        ParamValue: this.role.roleArn,
        ReaderAccountId: crossAccountRoleProps.assumeAccountID,
      }
    );
  }
}

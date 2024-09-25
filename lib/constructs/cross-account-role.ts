/**
 * Custom CDK construct that enables creating AWS IAM Roles that could be
 * assumed by cross-account prinicpals. This construct sets the policy document,
 * assume role account details as received in props and also creates an AWS SSM
 * parameter with cross-account read access (using SSMParamWriter construct)
 * with the roleArn value
 */

import { AccountPrincipal, PolicyStatement, Role } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";
import { SSMParamWriter } from "./ssm-param-writer";
import { name } from "./helpers";

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
    crossAccountRoleProps: CrossAccountRoleProps,
  ) {
    super(scope, id);

    /**
     * Create cross account role with trust policy set to the assuming account
     * ID principal
     */
    this.role = new Role(
      this,
      name(buildConfig, `${crossAccountRoleProps.roleNameKey}-role`),
      {
        assumedBy: new AccountPrincipal(crossAccountRoleProps.assumeAccountID),
      },
    );

    /**
     * Add the required permissions passed in as part of the construct
     * initiation
     */
    this.role.addToPrincipalPolicy(crossAccountRoleProps.policyStatement);

    /**
     * Write the roleArn parameter into SSM enabling the assuming account ID
     * with read permissions (through custom SSMParamWriter construct)
     */
    new SSMParamWriter(
      this,
      name(buildConfig, `${crossAccountRoleProps.roleNameKey}-roleArn`),
      buildConfig,
      {
        ParamNameKey: `${crossAccountRoleProps.roleNameKey}-roleArn`,
        ParamValue: this.role.roleArn,
        ReaderAccountId: crossAccountRoleProps.assumeAccountID,
      },
    );
  }
}

/*
Deploys roles in SSO account that allow SSO admin API, Identity Store api access from target account
*/
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BuildConfig } from "../../build/buildConfig";
import { CrossAccountRole } from "../../constructs/cross-account-role";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class SSOApiRoles extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    new CrossAccountRole(
      this,
      name(buildConfig, "waiterHandler-ssoapi-Role"),
      buildConfig,
      {
        assumeAccountID: buildConfig.PipelineSettings.TargetAccountId,
        roleNameKey: "waiterHandler-ssoapi",
        policyStatement: new PolicyStatement({
          resources: ["*"],
          actions: [
            "sso:DescribeAccountAssignmentDeletionStatus",
            "sso:DescribePermissionSetProvisioningStatus",
            "sso:DescribeAccountAssignmentCreationStatus",
          ],
        }),
      }
    );

    new CrossAccountRole(
      this,
      name(buildConfig, "permissionSetHandler-ssoapi-Role"),
      buildConfig,
      {
        assumeAccountID: buildConfig.PipelineSettings.TargetAccountId,
        roleNameKey: "permissionSetHandler-ssoapi",
        policyStatement: new PolicyStatement({
          resources: ["*"],
          actions: [
            "sso:DeleteInlinePolicyFromPermissionSet",
            "sso:DetachManagedPolicyFromPermissionSet",
            "sso:DeletePermissionSet",
            "sso:CreatePermissionSet",
            "sso:GetPermissionSet",
            "sso:TagResource",
            "sso:ListPermissionSetProvisioningStatus",
            "sso:UntagResource",
            "sso:ListInstances",
            "sso:DescribePermissionSet",
            "sso:ProvisionPermissionSet",
            "sso:ListPermissionSets",
            "sso:ListAccountsForProvisionedPermissionSet",
            "sso:PutInlinePolicyToPermissionSet",
            "sso:AttachManagedPolicyToPermissionSet",
            "sso:UpdatePermissionSet",
            "sso:GetInlinePolicyForPermissionSet",
            "sso:ListManagedPoliciesInPermissionSet",
            "sso:DescribePermissionSetProvisioningStatus",
          ],
        }),
      }
    );

    new CrossAccountRole(
      this,
      name(buildConfig, "linkManagerHandler-ssoapi-role"),
      buildConfig,
      {
        assumeAccountID: buildConfig.PipelineSettings.TargetAccountId,
        roleNameKey: "linkManagerHandler-ssoapi",
        policyStatement: new PolicyStatement({
          resources: ["*"],
          actions: [
            "sso:CreateAccountAssignment",
            "sso:DescribeAccountAssignmentDeletionStatus",
            "sso:ListAccountAssignmentDeletionStatus",
            "sso:DescribeAccountAssignmentCreationStatus",
            "sso:DeleteAccountAssignment",
            "sso:ListAccountAssignmentCreationStatus",
            "sso:ListAccountAssignments",
            "sso:ListInstances",
          ],
        }),
      }
    );

    new CrossAccountRole(
      this,
      name(buildConfig, "listInstances-ssoapi-role"),
      buildConfig,
      {
        assumeAccountID: buildConfig.PipelineSettings.TargetAccountId,
        roleNameKey: "listInstances-ssoapi",
        policyStatement: new PolicyStatement({
          resources: ["*"],
          actions: ["sso:ListInstances"],
        }),
      }
    );

    new CrossAccountRole(
      this,
      name(buildConfig, "listgroups-identitystoreapi-role"),
      buildConfig,
      {
        assumeAccountID: buildConfig.PipelineSettings.TargetAccountId,
        roleNameKey: "listgroups-identitystoreapi",
        policyStatement: new PolicyStatement({
          resources: ["*"],
          actions: ["identitystore:ListGroups", "identitystore:DescribeGroup"],
        }),
      }
    );
  }
}

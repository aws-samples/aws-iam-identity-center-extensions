/**
 * Deploys part 1 of artefacts required for importing current AWS IAM Identity
 * Center configuration i.e. permission sets and account assignments in SSO
 * account
 */
import { Stack, StackProps } from "aws-cdk-lib";
import {
  AccountPrincipal,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import {
  Architecture,
  Code,
  LayerVersion,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  CfnQueryDefinition,
  LogGroup,
  RetentionDays,
} from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { CfnStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../../build/buildConfig";
import { CrossAccountRole } from "../../constructs/cross-account-role";
import { SSMParamWriter } from "../../constructs/ssm-param-writer";
import * as importAccountAssignmentsSMJSON from "../../state-machines/import-account-assignments-asl.json";
import * as importCurrentConfigSMJSON from "../../state-machines/import-current-config-asl.json";
import * as importPermissionSetsSMJSON from "../../state-machines/import-permission-sets-asl.json";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class SSOImportArtefactsPart1 extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    // KMS Key for importTopis
    const ssoArtefactsKeyforImport = new Key(
      this,
      name(buildConfig, "ssoArtefactsKeyforImport"),
      {
        enableKeyRotation: true,
        alias: name(buildConfig, "ssoArtefactsKeyforImport"),
      }
    );
    ssoArtefactsKeyforImport.grantEncryptDecrypt(
      new ServicePrincipal("states.amazonaws.com")
    );

    // Topics that would allow cross account handlers to process import of existing configuration
    const permissionSetImportTopic = new Topic(
      this,
      name(buildConfig, "permissionSetImportTopic"),
      {
        masterKey: ssoArtefactsKeyforImport,
        displayName: name(buildConfig, "permissionSetImportTopic"),
      }
    );
    permissionSetImportTopic.addToResourcePolicy(
      new PolicyStatement({
        principals: [
          new AccountPrincipal(buildConfig.PipelineSettings.TargetAccountId),
        ],
        actions: ["SNS:Subscribe", "SNS:Receive"],
        resources: [permissionSetImportTopic.topicArn],
      })
    );
    new SSMParamWriter(
      this,
      name(buildConfig, "permissionSetImportTopicArn"),
      buildConfig,
      {
        ParamNameKey: "permissionSetImportTopicArn",
        ParamValue: permissionSetImportTopic.topicArn,
        ReaderAccountId: buildConfig.PipelineSettings.TargetAccountId,
      }
    );

    const accountAssignmentImportTopic = new Topic(
      this,
      name(buildConfig, "accountAssignmentImportTopic"),
      {
        masterKey: ssoArtefactsKeyforImport,
        displayName: name(buildConfig, "accountAssignmentImportTopic"),
      }
    );
    accountAssignmentImportTopic.addToResourcePolicy(
      new PolicyStatement({
        principals: [
          new AccountPrincipal(buildConfig.PipelineSettings.TargetAccountId),
        ],
        actions: ["SNS:Subscribe", "SNS:Receive"],
        resources: [accountAssignmentImportTopic.topicArn],
      })
    );
    new SSMParamWriter(
      this,
      name(buildConfig, "accountAssignmentImportTopicArn"),
      buildConfig,
      {
        ParamNameKey: "accountAssignmentImportTopicArn",
        ParamValue: accountAssignmentImportTopic.topicArn,
        ReaderAccountId: buildConfig.PipelineSettings.TargetAccountId,
      }
    );

    /** Log group to attach to all the state machines for capturing logs */
    const importArtefactsSMLogGroup = new LogGroup(
      this,
      name(buildConfig, "importArtefactsSMLogGroup"),
      {
        retention: RetentionDays.ONE_MONTH,
      }
    );

    /**
     * Custom lambda for describing customer managed policies and permission
     * boundary
     */

    const layersResource = new LayerVersion(
      this,
      name(buildConfig, "nodeJsLayerForCmpAndPb"),
      {
        code: Code.fromAsset(
          join(__dirname, "../../../", "lib", "lambda-layers", "nodejs-layer")
        ),
        compatibleRuntimes: [Runtime.NODEJS_20_X],
        compatibleArchitectures: [Architecture.ARM_64],
      }
    );

    const importCmpAndPb = new NodejsFunction(
      this,
      name(buildConfig, `importCmpAndPb`),
      {
        runtime: Runtime.NODEJS_20_X,
        architecture: Architecture.ARM_64,
        functionName: name(buildConfig, `importCmpAndPbHandler`),
        layers: [layersResource],
        entry: join(
          __dirname,
          "../../../",
          "lib",
          "lambda-functions",
          "current-config-handlers",
          "src",
          "import-customermanagedpolicies-permissionsboundary.ts"
        ),
        bundling: {
          externalModules: ["@aws-sdk/client-ssoadmin"],
          minify: true,
        },
      }
    );

    /**
     * Add describe permissions for reading customer managed policies and
     * permission boundaries
     */
    importCmpAndPb.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "sso:ListCustomerManagedPolicyReferencesInPermissionSet",
          "sso:GetPermissionsBoundaryForPermissionSet",
        ],
        resources: ["*"],
      })
    );

    new SSMParamWriter(
      this,
      name(buildConfig, "importCmpAndPbArn"),
      buildConfig,
      {
        ParamNameKey: "importCmpAndPbArn",
        ParamValue: importCmpAndPb.functionArn,
        ReaderAccountId: buildConfig.PipelineSettings.TargetAccountId,
      }
    );

    // State Machine 01 - Import Account Assignments

    const importAccountAssignmentsSMRole = new Role(
      this,
      name(buildConfig, "importAccountAssignmentsSMRole"),
      {
        roleName: name(buildConfig, "importAccountAssignmentsSMRole"),
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      }
    );
    importAccountAssignmentsSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: ["sso:ListAccountAssignments"],
      })
    );
    accountAssignmentImportTopic.grantPublish(importAccountAssignmentsSMRole);
    ssoArtefactsKeyforImport.grantEncryptDecrypt(
      importAccountAssignmentsSMRole
    );
    importAccountAssignmentsSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:DescribeExecution", "states:StopExecution"],
        resources: ["*"],
      })
    );
    importAccountAssignmentsSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["events:PutTargets", "events:PutRule", "events:DescribeRule"],
        resources: [
          `arn:aws:events:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:rule/StepFunctionsGetEventsForStepFunctionsExecutionRule`,
        ],
      })
    );

    importAccountAssignmentsSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: [
          "identitystore:ListGroups",
          "identitystore:ListUsers",
          "identitystore:DescribeGroup",
          "identitystore:DescribeUser",
        ],
      })
    );
    importAccountAssignmentsSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ],
        resources: ["*"],
      })
    );

    const importAccountAssignmentSM = new CfnStateMachine(
      this,
      name(buildConfig, "importAccountAssignmentSM"),
      {
        roleArn: importAccountAssignmentsSMRole.roleArn,
        definitionString: JSON.stringify(importAccountAssignmentsSMJSON),
        stateMachineName: name(buildConfig, "importAccountAssignmentSM"),
        loggingConfiguration: {
          destinations: [
            {
              cloudWatchLogsLogGroup: {
                logGroupArn: importArtefactsSMLogGroup.logGroupArn,
              },
            },
          ],
          includeExecutionData: true,
          level: "ALL",
        },
      }
    );
    importAccountAssignmentSM.node.addDependency(
      importAccountAssignmentsSMRole
    );

    // State Machine 02 - Import Permission Sets

    const importPermissionSetSMRole = new Role(
      this,
      name(buildConfig, "importPermissionSetSMRole"),
      {
        roleName: name(buildConfig, "importPermissionSetSMRole"),
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      }
    );
    importPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: [
          "sso:ListPermissionSets",
          "sso:DescribePermissionSet",
          "sso:ListManagedPoliciesInPermissionSet",
          "sso:GetInlinePolicyForPermissionSet",
          "sso:ListTagsForResource",
          "sso:ListAccountsForProvisionedPermissionSet",
        ],
      })
    );
    importPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem",
          "dynamodb:DeleteItem",
        ],
        resources: [
          `arn:aws:dynamodb:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:table/${buildConfig.Environment}-temp-PermissionSets`,
          `arn:aws:dynamodb:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:table/${buildConfig.Environment}-temp-PermissionSets/index/*`,
        ],
      })
    );
    importPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [importAccountAssignmentSM.ref],
      })
    );
    importPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:DescribeExecution", "states:StopExecution"],
        resources: ["*"],
      })
    );

    importPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["events:PutTargets", "events:PutRule", "events:DescribeRule"],
        resources: [
          `arn:aws:events:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:rule/StepFunctionsGetEventsForStepFunctionsExecutionRule`,
        ],
      })
    );
    importPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ],
        resources: ["*"],
      })
    );

    permissionSetImportTopic.grantPublish(importPermissionSetSMRole);
    ssoArtefactsKeyforImport.grantEncryptDecrypt(importPermissionSetSMRole);
    importCmpAndPb.grantInvoke(importPermissionSetSMRole);

    const importPermissionSetSM = new CfnStateMachine(
      this,
      name(buildConfig, "importPermissionSetSM"),
      {
        roleArn: importPermissionSetSMRole.roleArn,
        definitionString: JSON.stringify(importPermissionSetsSMJSON),
        stateMachineName: name(buildConfig, "importPermissionSetSM"),
        loggingConfiguration: {
          destinations: [
            {
              cloudWatchLogsLogGroup: {
                logGroupArn: importArtefactsSMLogGroup.logGroupArn,
              },
            },
          ],
          includeExecutionData: true,
          level: "ALL",
        },
      }
    );
    importPermissionSetSM.node.addDependency(importPermissionSetSMRole);

    // State Machine 03 - Parent state machine that orchestrates state machine 01 and 02

    const importCurrentConfigSMRole = new Role(
      this,
      name(buildConfig, "importCurrentConfigSMRole"),
      {
        roleName: name(buildConfig, "importCurrentConfigSMRole"),
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      }
    );
    importCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:CreateTable",
          "dynamodb:DeleteTable",
          "dynamodb:DescribeTable",
        ],
        resources: [
          `arn:aws:dynamodb:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:table/${buildConfig.Environment}-temp-PermissionSets`,
          `arn:aws:dynamodb:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:table/${buildConfig.Environment}-temp-PermissionSets/index/*`,
        ],
      })
    );
    importCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: ["sso:ListInstances"],
      })
    );
    importCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [importPermissionSetSM.ref],
      })
    );
    importCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:DescribeExecution", "states:StopExecution"],
        resources: ["*"],
      })
    );

    importCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["events:PutTargets", "events:PutRule", "events:DescribeRule"],
        resources: [
          `arn:aws:events:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:rule/StepFunctionsGetEventsForStepFunctionsExecutionRule`,
        ],
      })
    );
    importCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "logs:CreateLogDelivery",
          "logs:GetLogDelivery",
          "logs:UpdateLogDelivery",
          "logs:DeleteLogDelivery",
          "logs:ListLogDeliveries",
          "logs:PutResourcePolicy",
          "logs:DescribeResourcePolicies",
          "logs:DescribeLogGroups",
        ],
        resources: ["*"],
      })
    );

    const importCurrentConfigSM = new CfnStateMachine(
      this,
      name(buildConfig, "importCurrentConfigSM"),
      {
        roleArn: importCurrentConfigSMRole.roleArn,
        definitionString: JSON.stringify(importCurrentConfigSMJSON),
        stateMachineName: name(buildConfig, "importCurrentConfigSM"),
        loggingConfiguration: {
          destinations: [
            {
              cloudWatchLogsLogGroup: {
                logGroupArn: importArtefactsSMLogGroup.logGroupArn,
              },
            },
          ],
          includeExecutionData: true,
          level: "ALL",
        },
      }
    );

    importCurrentConfigSM.node.addDependency(importCurrentConfigSMRole);

    new CrossAccountRole(this, name(buildConfig, "ssoListRole"), buildConfig, {
      assumeAccountID: buildConfig.PipelineSettings.TargetAccountId,
      roleNameKey: "ssoList-ssoapi",
      policyStatement: new PolicyStatement({
        resources: [importCurrentConfigSM.ref],
        actions: ["states:StartExecution"],
      }),
    });

    new CrossAccountRole(
      this,
      name(buildConfig, "smDescribeRole"),
      buildConfig,
      {
        assumeAccountID: buildConfig.PipelineSettings.TargetAccountId,
        roleNameKey: "smDescribe-ssoapi",
        policyStatement: new PolicyStatement({
          resources: ["*"],
          actions: ["states:DescribeExecution"],
        }),
      }
    );

    /** CloudWatch insights query to debug errors, if any */
    new CfnQueryDefinition(
      this,
      name(buildConfig, "importCurrentSSOConfiguration-errors"),
      {
        name: name(buildConfig, "importCurrentSSOConfiguration-errors"),
        queryString:
          "filter @message like 'solutionError' and details.name not like 'Catchall'| sort id asc",
        logGroupNames: [importArtefactsSMLogGroup.logGroupName],
      }
    );
  }
}

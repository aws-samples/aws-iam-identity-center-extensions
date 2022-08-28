/** Deploys artefacts that would handle customer managed policy CRUD */
import { Stack, StackProps } from "aws-cdk-lib";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Architecture, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { CfnStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../../build/buildConfig";
import { CrossAccountRole } from "../../constructs/cross-account-role";
import { LambdaLayers } from "../../constructs/lambda-layers";
import { SSMParamWriter } from "../../constructs/ssm-param-writer";
import * as customerManagedPolicySMJSON from "../../state-machines/customer-managed-policies-asl.json";
import * as managedPolicySMJSON from "../../state-machines/managed-policies-asl.json";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class ManagedPolicies extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    /** Define lambda layer for AWS SDK v3 */
    const deployLambdaLayer = new LambdaLayers(
      this,
      name(buildConfig, `lambdaLayersforCMP`),
      buildConfig
    );

    /**
     * Define lambda function to implement iterator logic for describe calls on
     * managed policy operations
     */
    const describeOpIterator = new NodejsFunction(
      this,
      name(buildConfig, `describeOpIterator`),
      {
        runtime: Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        functionName: name(buildConfig, `describeOpIterator`),
        entry: join(
          __dirname,
          "../../../",
          "lib",
          "lambda-functions",
          "managed-policy-handlers",
          "src",
          "describeOpIterator.ts"
        ),
        bundling: {
          minify: true,
        },
      }
    );

    /** Export function ARN as cross-account/region parameter */
    new SSMParamWriter(this, name(buildConfig, "iteratorArn"), buildConfig, {
      ParamNameKey: "iteratorArn",
      ParamValue: describeOpIterator.functionArn,
      ReaderAccountId: buildConfig.PipelineSettings.TargetAccountId,
    });

    /** Define lambda function to attach/detach/describe customer managed policies */
    const processCustomerManagedPolicyHandler = new NodejsFunction(
      this,
      name(buildConfig, `processCustomerManagedPolicyHandler`),
      {
        runtime: Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        functionName: name(buildConfig, `processCustomerManagedPolicyHandler`),
        layers: [deployLambdaLayer.nodeJsLayer],
        entry: join(
          __dirname,
          "../../../",
          "lib",
          "lambda-functions",
          "managed-policy-handlers",
          "src",
          "processCustomerManagedPolicy.ts"
        ),
        bundling: {
          externalModules: ["@aws-sdk/client-sso-admin"],
          minify: true,
        },
        environment: {
          functionLogMode: buildConfig.Parameters.FunctionLogMode,
        },
      }
    );

    /** Grant lambda permissions to attach/detach/describe customer managed policies */

    processCustomerManagedPolicyHandler.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "sso:AttachCustomerManagedPolicyReferenceToPermissionSet",
          "sso:DetachCustomerManagedPolicyReferenceFromPermissionSet",
          "sso:ListCustomerManagedPolicyReferencesInPermissionSet",
        ],
        resources: ["*"],
      })
    );

    /** Export function ARN as cross-account/region parameter */
    new SSMParamWriter(
      this,
      name(buildConfig, "customerManagedPolicyProcessOpArn"),
      buildConfig,
      {
        ParamNameKey: "customerManagedPolicyProcessOpArn",
        ParamValue: processCustomerManagedPolicyHandler.functionArn,
        ReaderAccountId: buildConfig.PipelineSettings.TargetAccountId,
      }
    );

    /** Cloud watch log group for directing all state machine logging */
    const customerManagedPolicySMLogGroup = new LogGroup(
      this,
      name(buildConfig, "customerManagedPolicySMLogGroup"),
      {
        retention: RetentionDays.ONE_MONTH,
      }
    );

    /**
     * Define IAM role for the state machine that would handle customer managed
     * policy operations
     */

    const customerManagedPolicySMRole = new Role(
      this,
      name(buildConfig, "customerManagedPolicySMRole"),
      {
        roleName: name(buildConfig, "customerManagedPolicySMRole"),
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      }
    );

    /** Grant the IAM role permissions to invoke the lambda functions */
    processCustomerManagedPolicyHandler.grantInvoke(
      customerManagedPolicySMRole
    );
    describeOpIterator.grantInvoke(customerManagedPolicySMRole);
    customerManagedPolicySMRole.addToPrincipalPolicy(
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

    /** Define state machine that would handle customer managed policy operations */
    const customerManagedPolicySM = new CfnStateMachine(
      this,
      name(buildConfig, "customerManagedPolicySM"),
      {
        roleArn: customerManagedPolicySMRole.roleArn,
        definitionString: JSON.stringify(customerManagedPolicySMJSON),
        stateMachineName: name(buildConfig, "customerManagedPolicySM"),
        loggingConfiguration: {
          destinations: [
            {
              cloudWatchLogsLogGroup: {
                logGroupArn: customerManagedPolicySMLogGroup.logGroupArn,
              },
            },
          ],
          includeExecutionData: true,
          level: "ALL",
        },
      }
    );

    customerManagedPolicySM.node.addDependency(customerManagedPolicySMRole);

    /** Define lambda function to attach/detach/describe managed policies */
    const processManagedPolicyHandler = new NodejsFunction(
      this,
      name(buildConfig, `processManagedPolicyHandler`),
      {
        runtime: Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        functionName: name(buildConfig, `processManagedPolicyHandler`),
        layers: [deployLambdaLayer.nodeJsLayer],
        entry: join(
          __dirname,
          "../../../",
          "lib",
          "lambda-functions",
          "managed-policy-handlers",
          "src",
          "processManagedPolicy.ts"
        ),
        bundling: {
          externalModules: ["@aws-sdk/client-sso-admin"],
          minify: true,
        },
        environment: {
          functionLogMode: buildConfig.Parameters.FunctionLogMode,
        },
      }
    );

    /** Grant lambda permissions to attach/detach/describe managed policies */

    processManagedPolicyHandler.addToRolePolicy(
      new PolicyStatement({
        actions: [
          "sso:AttachManagedPolicyToPermissionSet",
          "sso:DetachManagedPolicyFromPermissionSet",
          "sso:ListManagedPoliciesInPermissionSet",
        ],
        resources: ["*"],
      })
    );

    /** Export function ARN as cross-account/region parameter */
    new SSMParamWriter(
      this,
      name(buildConfig, "managedPolicyProcessOpArn"),
      buildConfig,
      {
        ParamNameKey: "managedPolicyProcessOpArn",
        ParamValue: processManagedPolicyHandler.functionArn,
        ReaderAccountId: buildConfig.PipelineSettings.TargetAccountId,
      }
    );

    /** Cloud watch log group for directing all state machine logging */
    const managedPolicySMLogGroup = new LogGroup(
      this,
      name(buildConfig, "managedPolicySMLogGroup"),
      {
        retention: RetentionDays.ONE_MONTH,
      }
    );

    /**
     * Define IAM role for the state machine that would handle customer managed
     * policy operations
     */

    const managedPolicySMRole = new Role(
      this,
      name(buildConfig, "managedPolicySMRole"),
      {
        roleName: name(buildConfig, "managedPolicySMRole"),
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      }
    );

    /** Grant the IAM role permissions to invoke the lambda functions */
    processManagedPolicyHandler.grantInvoke(managedPolicySMRole);
    describeOpIterator.grantInvoke(managedPolicySMRole);
    managedPolicySMRole.addToPrincipalPolicy(
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

    /** Define state machine that would handle managed policy operations */
    const managedPolicySM = new CfnStateMachine(
      this,
      name(buildConfig, "managedPolicySM"),
      {
        roleArn: managedPolicySMRole.roleArn,
        definitionString: JSON.stringify(managedPolicySMJSON),
        stateMachineName: name(buildConfig, "managedPolicySM"),
        loggingConfiguration: {
          destinations: [
            {
              cloudWatchLogsLogGroup: {
                logGroupArn: managedPolicySMLogGroup.logGroupArn,
              },
            },
          ],
          includeExecutionData: true,
          level: "ALL",
        },
      }
    );

    managedPolicySM.node.addDependency(managedPolicySMRole);

    new CrossAccountRole(this, name(buildConfig, "ssoMpRole"), buildConfig, {
      assumeAccountID: buildConfig.PipelineSettings.TargetAccountId,
      roleNameKey: "ssoMp-ssoapi",
      policyStatement: new PolicyStatement({
        resources: [
          `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-managedPolicySM`,
          `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-customerManagedPolicySM`,
        ],
        actions: ["states:StartExecution"],
      }),
    });
  }
}

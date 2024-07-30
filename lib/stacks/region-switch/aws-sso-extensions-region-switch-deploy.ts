import { CustomResource, Duration, Stack, StackProps } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
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
import { CfnStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { join } from "path";
import { RegionSwitchBuildConfig } from "../../build/regionSwitchBuildConfig";
import * as deployRegionSwitchObjectsJSON from "../../state-machines/deploy-region-switch-objects-asl.json";

/** Helper name function */
function fullname(name: string): string {
  return `aws-sso-extensions-region-switch-deploy-${name}`;
}

export class AwsSsoExtensionsRegionSwitchDeploy extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: RegionSwitchBuildConfig
  ) {
    super(scope, id, props);

    /**
     * Lambda layer to package AWS JS SDK v3 as lambda run time still uses AWS
     * JS SDK v2 and uuid library for observability logging
     */
    const rsNodeJsLayer = new LayerVersion(this, fullname("rsNodeJsLayer"), {
      code: Code.fromAsset(
        join(__dirname, "../../", "lambda-layers", "nodejs-layer")
      ),
      compatibleRuntimes: [Runtime.NODEJS_20_X],
      compatibleArchitectures: [Architecture.ARM_64],
    });

    /**
     * Global tables created in the discover phase are imported here to enable
     * permissions for the deploy state machine to read the information. The
     * initialistion is done through fromTableAttributes and globalIndexes are
     * explicity specified so that CDK assigns the correct permissions on
     * grantRead actions. Without this approach, grantRead does not add read
     * permissions on the GSI's
     */
    const globalPermissionSetsTable = Table.fromTableAttributes(
      this,
      fullname("importedGlobalPermissionSetsTable"),
      {
        tableName:
          "aws-sso-extensions-region-switch-discover-globalPermissionSetsTable",
      }
    );
    const globalAccountAssignmentsTable = Table.fromTableAttributes(
      this,
      fullname("importedGlobalAccountAssignmentsTable"),
      {
        tableName:
          "aws-sso-extensions-region-switch-discover-globalAccountAssignmentsTable",
        globalIndexes: ["permissionSetName"],
      }
    );

    /**
     * Helper lambda that would take a permission set object in the format used
     * by the solution and create the required permission object and it's
     * attributes in the new region. Since the lambda would create permission
     * set and all the related artefacts the required permissions are provided
     * for SSO admin API permission set operations
     */
    const rsCreatePermissionSetsHandler = new NodejsFunction(
      this,
      fullname(`rsCreatePermissionSetsHandler`),
      {
        runtime: Runtime.NODEJS_20_X,
        architecture: Architecture.ARM_64,
        layers: [rsNodeJsLayer],
        entry: join(
          __dirname,
          "../../",
          "lambda-functions",
          "region-switch",
          "src",
          "rs-create-permission-sets.ts"
        ),
        bundling: {
          externalModules: [
            "uuid",
            "@aws-sdk/client-sso-admin",
            "@aws-sdk/util-dynamodb",
          ],
          minify: true,
        },
      }
    );
    rsCreatePermissionSetsHandler.addToRolePolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: [
          "sso:CreatePermissionSet",
          "sso:TagResource",
          "sso:DescribePermissionSet",
          "sso:PutInlinePolicyToPermissionSet",
          "sso:AttachManagedPolicyToPermissionSet",
          "sso:UpdatePermissionSet",
        ],
      })
    );

    /** Log group to attach to deploy state machine for capturing logs */
    const deploySMLogGroup = new LogGroup(this, fullname("deploySMLogGroup"), {
      retention: RetentionDays.ONE_MONTH,
    });

    /**
     * IAM role that would be attached to the deploy state machine for
     * re-creating account assignments and permission sets in the new region.
     * This role adds trust policy for step functions service, grants read
     * access to both the global tables for reading discovered data, access to
     * write to cloud watch log group and finally grants access for SSO admin
     * API operations
     */
    const deploySMRole = new Role(this, fullname(`deploySMRole`), {
      assumedBy: new ServicePrincipal("states.amazonaws.com"),
    });

    globalAccountAssignmentsTable.grantReadData(deploySMRole);
    globalPermissionSetsTable.grantReadData(deploySMRole);
    rsCreatePermissionSetsHandler.grantInvoke(deploySMRole);
    deploySMRole.addToPrincipalPolicy(
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
    deploySMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "sso:DescribeAccountAssignmentCreationStatus",
          "sso:CreateAccountAssignment",
          "sso:ListInstances",
          "identitystore:ListGroups",
          "identitystore:ListUsers",
        ],
        resources: ["*"],
      })
    );

    /**
     * Deploy state machine definition along with CloudWatch log group based
     * logging strategy including execution data and all log levels. Also add
     * dependencies such that the state machine role and cloud watch log group
     * are created prior to the state machine being created
     */
    const deploySM = new CfnStateMachine(this, fullname("deploySM"), {
      roleArn: deploySMRole.roleArn,
      definitionString: JSON.stringify(deployRegionSwitchObjectsJSON),
      loggingConfiguration: {
        destinations: [
          {
            cloudWatchLogsLogGroup: {
              logGroupArn: deploySMLogGroup.logGroupArn,
            },
          },
        ],
        includeExecutionData: true,
        level: "ALL",
      },
    });
    deploySM.node.addDependency(deploySMRole);
    deploySM.node.addDependency(deploySMLogGroup);

    /**
     * Cloudformation custom resource artefacts that would trigger the state
     * machine created above on create/update/delete type Cloudformation events.
     * We use CDK custom resource framework to define separate onEvent and
     * isComplete handlers to update CloudFormation on the status of deploy
     * state machine execution
     */
    /**
     * Custom lambda function that updates CloudFormation on whether the state
     * machine is still running/completed/failed/timed out. Provided permissions
     * to describe state machine executions
     */
    const updateCustomResourceHandler = new NodejsFunction(
      this,
      fullname(`updateCustomResourceHandler`),
      {
        runtime: Runtime.NODEJS_20_X,
        layers: [rsNodeJsLayer],
        entry: join(
          __dirname,
          "../../",
          "lambda-functions",
          "region-switch",
          "src",
          "update-custom-resource.ts"
        ),
        bundling: {
          externalModules: ["@aws-sdk/client-sfn"],
          minify: true,
        },
        environment: {
          ssoAccountId: buildConfig.SSOServiceAccountId,
          ssoRegion: buildConfig.SSOServiceTargetAccountRegion,
        },
      }
    );
    if (updateCustomResourceHandler.role) {
      updateCustomResourceHandler.addToRolePolicy(
        new PolicyStatement({
          actions: ["states:DescribeExecution", "states:StopExecution"],
          resources: ["*"],
        })
      );
    }

    /**
     * Custom lambda function that is triggered on cloud formation
     * create/update/delete calls by CDK provider. Provided permissions to
     * invoke the state machine
     */
    const parentSMInvokeFunction = new NodejsFunction(
      this,
      fullname(`parentSMInvokeFunction`),
      {
        runtime: Runtime.NODEJS_20_X,
        architecture: Architecture.ARM_64,
        functionName: fullname(`parentSMInvokeFunction`),
        layers: [rsNodeJsLayer],
        entry: join(
          __dirname,
          "../../",
          "lambda-functions",
          "region-switch",
          "src",
          "trigger-deploySM.ts"
        ),
        bundling: {
          externalModules: ["@aws-sdk/client-sfn", "uuid"],
          minify: true,
        },
      }
    );
    if (parentSMInvokeFunction.role) {
      parentSMInvokeFunction.role.addToPrincipalPolicy(
        new PolicyStatement({
          actions: ["states:StartExecution"],
          resources: [deploySM.ref],
        })
      );
    }

    /**
     * CDK custom resource provider definition that uses both an isComplete and
     * onEvent handler types
     */
    const parentSMInvokeProvider = new Provider(
      this,
      fullname("parentSMInvokeProvider"),
      {
        onEventHandler: parentSMInvokeFunction,
        isCompleteHandler: updateCustomResourceHandler,
        queryInterval: Duration.minutes(1),
        totalTimeout: Duration.minutes(240), // to handle scenarios where organisations have a lot of permission sets and account assignments discovered
      }
    );

    /**
     * Custom resource definition that uses all the three artefacts for defining
     * the resource that triggers current config import state machine and waits
     * until it completes/fails/times out
     */
    const parentSMResource = new CustomResource(
      this,
      fullname("parentSMResource"),
      {
        serviceToken: parentSMInvokeProvider.serviceToken,
        properties: {
          deploySMArn: deploySM.ref,
          globalPermissionSetsTableName: globalPermissionSetsTable.tableName,
          globalAccountAssignmentsTable:
            globalAccountAssignmentsTable.tableName,
          CreatePSFunctionName: rsCreatePermissionSetsHandler.functionName,
        },
      }
    );
    /**
     * Add dependencies to ensure that the custom resource creation is not
     * invoked prior to the dependent resources being created
     */
    parentSMResource.node.addDependency(rsCreatePermissionSetsHandler);
    parentSMResource.node.addDependency(updateCustomResourceHandler);

    /** CloudWatch insights query to debug errors, if any */
    new CfnQueryDefinition(this, fullname("-errors"), {
      name: fullname("-errors"),
      queryString:
        "filter @message like 'solutionError' and details.name not like 'Catchall'| sort id asc",
      logGroupNames: [deploySMLogGroup.logGroupName],
    });
  }
}

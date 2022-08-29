import {
  CustomResource,
  Duration,
  RemovalPolicy,
  Stack,
  StackProps,
} from "aws-cdk-lib";
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
} from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import {
  Architecture,
  Code,
  LayerVersion,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { SnsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  CfnQueryDefinition,
  LogGroup,
  RetentionDays,
} from "aws-cdk-lib/aws-logs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { CfnStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { join } from "path";
import { RegionSwitchBuildConfig } from "../../build/regionSwitchBuildConfig";
import * as importAccountAssignmentsSMJSON from "../../state-machines/import-account-assignments-asl.json";
import * as importCurrentConfigSMJSON from "../../state-machines/import-current-config-asl.json";
import * as importPermissionSetsSMJSON from "../../state-machines/import-permission-sets-asl.json";

function fullname(name: string): string {
  return `aws-sso-extensions-region-switch-discover-${name}`;
}

export class AwsSsoExtensionsRegionSwitchDiscover extends Stack {
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
      compatibleRuntimes: [Runtime.NODEJS_16_X],
      compatibleArchitectures: [Architecture.ARM_64],
    });

    /**
     * Global tables with replication region set to target SSO region that would
     * be used in the `deploy` phase and populated in the `discover` phase.
     * Global account assignments table has a GSI for permission set name to
     * enable sequential processing in the `discover` phase
     */
    const globalPermissionSetsTable = new Table(
      this,
      fullname("globalPermissionSetsTable"),
      {
        partitionKey: {
          name: "permissionSetName",
          type: AttributeType.STRING,
        },
        tableName: fullname("globalPermissionSetsTable"),
        billingMode: BillingMode.PAY_PER_REQUEST,
        encryption: TableEncryption.DEFAULT,
        removalPolicy: RemovalPolicy.DESTROY,
        replicationRegions: [buildConfig.SSOServiceTargetAccountRegion],
      }
    );
    const globalAccountAssignmentsTable = new Table(
      this,
      fullname("globalAccountAssignmentsTable"),
      {
        partitionKey: {
          name: "awsEntityId",
          type: AttributeType.STRING,
        },
        tableName: fullname("globalAccountAssignmentsTable"),
        billingMode: BillingMode.PAY_PER_REQUEST,
        encryption: TableEncryption.DEFAULT,
        removalPolicy: RemovalPolicy.DESTROY,
        replicationRegions: [buildConfig.SSOServiceTargetAccountRegion],
      }
    );
    globalAccountAssignmentsTable.addGlobalSecondaryIndex({
      indexName: "permissionSetName",
      partitionKey: {
        name: "permissionSetName",
        type: AttributeType.STRING,
      },
    });

    /** Artefacts to discover current AWS SSO configuration */

    /**
     * SNS topics that would be triggered by state machines with payload
     * containing either permission set/ account assignment details
     */
    const rsPermissionSetImportTopic = new Topic(
      this,
      fullname("rsPermissionSetImportTopic"),
      {
        displayName: fullname("rsPermissionSetImportTopic"),
      }
    );
    const rsAccountAssignmentImportTopic = new Topic(
      this,
      fullname("rsAccountAssignmentImportTopic"),
      {
        displayName: fullname("rsAccountAssignmentImportTopic"),
      }
    );

    /** State machines that discover the current AWS SSO configuration */

    /**
     * Account assignment discovery state machine related artefacts This state
     * machine discovers all the current account assignments for a given
     * permission set
     */

    /** Log group to attach to discover state machine for capturing logs */
    const discoverSMLogGroup = new LogGroup(
      this,
      fullname("discoverSMLogGroup"),
      {
        retention: RetentionDays.ONE_MONTH,
      }
    );

    /**
     * IAM role used by the account assignment discovery state machine. Trust
     * policy tied to state machine service Permissions policy allows read
     * permissions to discover SSO account assignments Also, grants publish
     * permissions to post account assignment paylaods to the import topic and
     * permissions to write to cloud watch logs
     */
    const rsImportAccountAssignmentsSMRole = new Role(
      this,
      fullname("rsImportAccountAssignmentsSMRole"),
      {
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      }
    );
    rsImportAccountAssignmentsSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: ["sso:ListAccountAssignments"],
      })
    );
    rsImportAccountAssignmentsSMRole.addToPrincipalPolicy(
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
    rsImportAccountAssignmentsSMRole.addToPrincipalPolicy(
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
    rsAccountAssignmentImportTopic.grantPublish(
      rsImportAccountAssignmentsSMRole
    );

    /**
     * State machine definition Load the def from JSON file and add dependency
     * to ensure the state machine's IAM role is created prior to the state
     * machine being created
     */
    const rsImportAccountAssignmentSM = new CfnStateMachine(
      this,
      fullname("rsImportAccountAssignmentSM"),
      {
        roleArn: rsImportAccountAssignmentsSMRole.roleArn,
        definitionString: JSON.stringify(importAccountAssignmentsSMJSON),
        stateMachineName: fullname("rsImportAccountAssignmentSM"),
        loggingConfiguration: {
          destinations: [
            {
              cloudWatchLogsLogGroup: {
                logGroupArn: discoverSMLogGroup.logGroupArn,
              },
            },
          ],
          includeExecutionData: true,
          level: "ALL",
        },
      }
    );
    rsImportAccountAssignmentSM.node.addDependency(
      rsImportAccountAssignmentsSMRole
    );
    rsImportAccountAssignmentSM.node.addDependency(discoverSMLogGroup);

    /**
     * Permission set discovery state machine related artefacts This state
     * machine discovers all the permission sets and the attributes of a
     * permission set
     */

    /**
     * IAM role used by the permission set discovery state machine. Trust policy
     * tied to state machine service Permissions policy allows read permissions
     * to discover permission sets including current assignments. Also grants
     * permissions for CRUD operations on temporary dynamo DB table used to
     * stage permission set related data Also, specific permissions granted so
     * that this state machine can invoke and orchestrate invocation of account
     * discovery state machine Also, grants publish permissions to post
     * permission set paylaods to the import topic and permissions to write to
     * cloud watch logs
     */
    const rsImportPermissionSetSMRole = new Role(
      this,
      fullname("rsImportPermissionSetSMRole"),
      {
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      }
    );
    rsImportPermissionSetSMRole.addToPrincipalPolicy(
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
    rsImportPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:GetItem",
          "dynamodb:DeleteItem",
        ],
        resources: [
          `arn:aws:dynamodb:${buildConfig.SSOServiceAccountRegion}:${buildConfig.SSOServiceAccountId}:table/rs-temp-PermissionSets`,
          `arn:aws:dynamodb:${buildConfig.SSOServiceAccountRegion}:${buildConfig.SSOServiceAccountId}:table/rs-temp-PermissionSets/index/*`,
        ],
      })
    );
    rsImportPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [rsImportAccountAssignmentSM.ref],
      })
    );
    rsImportPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:DescribeExecution", "states:StopExecution"],
        resources: ["*"],
      })
    );
    rsImportPermissionSetSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["events:PutTargets", "events:PutRule", "events:DescribeRule"],
        resources: [
          `arn:aws:events:${buildConfig.SSOServiceAccountRegion}:${buildConfig.SSOServiceAccountId}:rule/StepFunctionsGetEventsForStepFunctionsExecutionRule`,
        ],
      })
    );
    rsImportPermissionSetSMRole.addToPrincipalPolicy(
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
    rsPermissionSetImportTopic.grantPublish(rsImportPermissionSetSMRole);

    /**
     * State machine definition Load the def from JSON file and add dependency
     * to ensure the state machine's IAM role is created prior to the state
     * machine being created
     */
    const rsImportPermissionSetSM = new CfnStateMachine(
      this,
      fullname("rsImportPermissionSetSM"),
      {
        roleArn: rsImportPermissionSetSMRole.roleArn,
        definitionString: JSON.stringify(importPermissionSetsSMJSON),
        stateMachineName: fullname("rsImportPermissionSetSM"),
        loggingConfiguration: {
          destinations: [
            {
              cloudWatchLogsLogGroup: {
                logGroupArn: discoverSMLogGroup.logGroupArn,
              },
            },
          ],
          includeExecutionData: true,
          level: "ALL",
        },
      }
    );
    rsImportPermissionSetSM.node.addDependency(rsImportPermissionSetSMRole);
    rsImportPermissionSetSM.node.addDependency(discoverSMLogGroup);

    /**
     * Current config import state machine related artefacts This state machine
     * invokes the permission set discovery state machine that then invokes the
     * account assignment discovery state machine
     */

    /**
     * IAM role used by the current config import state machine. Trust policy
     * tied to state machine service Permissions policy allows read permissions
     * to list SSO instance Also grants permissions for table create/delete
     * privileges on temporary dynamo DB table used to stage permission set
     * related data Also, specific permissions granted so that this state
     * machine can invoke and orchestrate invocation of permission set discovery
     * state machine and permissions to write to logs
     */
    const rsImportCurrentConfigSMRole = new Role(
      this,
      fullname("rsImportCurrentConfigSMRole"),
      {
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      }
    );
    rsImportCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: [
          "dynamodb:CreateTable",
          "dynamodb:DeleteTable",
          "dynamodb:DescribeTable",
        ],
        resources: [
          `arn:aws:dynamodb:${buildConfig.SSOServiceAccountRegion}:${buildConfig.SSOServiceAccountId}:table/rs-temp-PermissionSets`,
          `arn:aws:dynamodb:${buildConfig.SSOServiceAccountRegion}:${buildConfig.SSOServiceAccountId}:table/rs-temp-PermissionSets/index/*`,
        ],
      })
    );
    rsImportCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: ["sso:ListInstances"],
      })
    );
    rsImportCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:StartExecution"],
        resources: [rsImportPermissionSetSM.ref],
      })
    );
    rsImportCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["states:DescribeExecution", "states:StopExecution"],
        resources: ["*"],
      })
    );
    rsImportCurrentConfigSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["events:PutTargets", "events:PutRule", "events:DescribeRule"],
        resources: [
          `arn:aws:events:${buildConfig.SSOServiceAccountRegion}:${buildConfig.SSOServiceAccountId}:rule/StepFunctionsGetEventsForStepFunctionsExecutionRule`,
        ],
      })
    );
    rsImportCurrentConfigSMRole.addToPrincipalPolicy(
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

    /**
     * State machine definition Load the def from JSON file and add dependency
     * to ensure the state machine's IAM role is created prior to the state
     * machine being created
     */
    const rsImportCurrentConfigSM = new CfnStateMachine(
      this,
      fullname("rsImportCurrentConfigSM"),
      {
        roleArn: rsImportCurrentConfigSMRole.roleArn,
        definitionString: JSON.stringify(importCurrentConfigSMJSON),
        stateMachineName: fullname("rsImportCurrentConfigSM"),
        loggingConfiguration: {
          destinations: [
            {
              cloudWatchLogsLogGroup: {
                logGroupArn: discoverSMLogGroup.logGroupArn,
              },
            },
          ],
          includeExecutionData: true,
          level: "ALL",
        },
      }
    );
    rsImportCurrentConfigSM.node.addDependency(rsImportCurrentConfigSMRole);
    rsImportCurrentConfigSM.node.addDependency(discoverSMLogGroup);

    /**
     * Permission set import handler, triggered by permission set import topic.
     * Upserts into global permission set table
     */
    const rsImportPermissionSetsHandler = new NodejsFunction(
      this,
      fullname(`rsImportPermissionSetsHandler`),
      {
        runtime: Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        layers: [rsNodeJsLayer],
        entry: join(
          __dirname,
          "../../",
          "lambda-functions",
          "region-switch",
          "src",
          "rs-import-permission-sets.ts"
        ),
        bundling: {
          externalModules: [
            "uuid",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
          ],
          minify: true,
        },
        environment: {
          globalPermissionSetTableName: globalPermissionSetsTable.tableName,
        },
      }
    );

    /**
     * Add permissions so that the permission set import handler can read/write
     * to the global permission set table. Also, configure the event source as
     * the permission set import topic
     */
    globalPermissionSetsTable.grantReadWriteData(rsImportPermissionSetsHandler);
    rsImportPermissionSetsHandler.addEventSource(
      new SnsEventSource(rsPermissionSetImportTopic)
    );

    /**
     * Account assignment set import handler, triggered by account assignment
     * import topic. Upserts into global account assignment table
     */
    const rsImportAccountAssignmentsHandler = new NodejsFunction(
      this,
      fullname(`rsImportAccountAssignmentHandler`),
      {
        runtime: Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        layers: [rsNodeJsLayer],
        entry: join(
          __dirname,
          "../../",
          "lambda-functions",
          "region-switch",
          "src",
          "rs-import-account-assignments.ts"
        ),
        bundling: {
          externalModules: [
            "uuid",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
          ],
          minify: true,
        },
        environment: {
          globalAccountAssignmentsTableName:
            globalAccountAssignmentsTable.tableName,
        },
      }
    );
    /**
     * Add permissions so that the account assignment import handler can
     * read/write to the global account assignments table. Also, configure the
     * event source as the accountt assignment import topic
     */
    globalAccountAssignmentsTable.grantReadWriteData(
      rsImportAccountAssignmentsHandler
    );
    rsImportAccountAssignmentsHandler.addEventSource(
      new SnsEventSource(rsAccountAssignmentImportTopic)
    );

    /**
     * Custom Resource artefacts This custom resource triggers the current
     * config import state machine and waits either until the state machine is
     * successfully completed/ state machine throws an error/ state machine
     * times out i.e. state machine exceeds 120 minutes. This is to accommodate
     * for cases where there are a large number of SSO objects
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
        runtime: Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
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
          ssoRegion: buildConfig.SSOServiceAccountRegion,
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
        runtime: Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        functionName: fullname(`parentSMInvokeFunction`),
        layers: [rsNodeJsLayer],
        entry: join(
          __dirname,
          "../../",
          "lambda-functions",
          "region-switch",
          "src",
          "trigger-parentSM.ts"
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
          resources: [rsImportCurrentConfigSM.ref],
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
        queryInterval: Duration.seconds(5),
        totalTimeout: Duration.minutes(120), // to handle scenarios where organisations have a lot of existing account assignments already
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
          importCurrentConfigSMArn: rsImportCurrentConfigSM.ref,
          importAccountAssignmentSMArn: rsImportAccountAssignmentSM.ref,
          importPermissionSetSMArn: rsImportPermissionSetSM.ref,
          accountAssignmentImportTopicArn:
            rsAccountAssignmentImportTopic.topicArn,
          permissionSetImportTopicArn: rsPermissionSetImportTopic.topicArn,
          temporaryPermissionSetTableName: `rs-temp-PermissionSets`,
          ssoRegion: buildConfig.SSOServiceAccountRegion,
        },
      }
    );

    parentSMResource.node.addDependency(rsImportAccountAssignmentsHandler);
    parentSMResource.node.addDependency(rsImportPermissionSetsHandler);
    parentSMResource.node.addDependency(updateCustomResourceHandler);

    /** CloudWatch insights query to debug errors, if any */
    new CfnQueryDefinition(this, fullname("-errors"), {
      name: fullname("-errors"),
      queryString:
        "filter @message like 'solutionError' and details.name not like 'Catchall'| sort id asc",
      logGroupNames: [discoverSMLogGroup.logGroupName],
    });
  }
}

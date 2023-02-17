/**
 * Deploys a custom resource that would upgrade account assignment data from old
 * format i.e. dot based delimiter to new format i.e. percent symbol
 */
import { CustomResource, Duration, Stack, StackProps } from "aws-cdk-lib";
import { Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Architecture, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import {
  CfnQueryDefinition,
  LogGroup,
  RetentionDays,
} from "aws-cdk-lib/aws-logs";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { CfnStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../../build/buildConfig";
import * as upgradeV303SMJson from "../../state-machines/upgrade-to-v303-asl.json";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class UpgradeToV303 extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    const artefactsBucket = Bucket.fromBucketName(
      this,
      name(buildConfig, "artefactsBucket"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "ssoArtefactsBucketName")
      )
    );

    const tablesKey = Key.fromKeyArn(
      this,
      name(buildConfig, "tablesKey"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "ddbTablesKeyArn")
      )
    );

    const bucketKey = Key.fromKeyArn(
      this,
      name(buildConfig, "bucketKey"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "ssoArtefactsBucketKeyArn")
      )
    );

    const nodeJsLayer = LayerVersion.fromLayerVersionArn(
      this,
      name(buildConfig, "NodeJsLayerVersion"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "nodeJsLayerVersionArn")
      ).toString()
    );

    const linksTable = Table.fromTableAttributes(
      this,
      name(buildConfig, "importedLinksTable"),
      {
        tableArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "linksTableArn")
        ),
        globalIndexes: [
          "awsEntityData",
          "principalName",
          "permissionSetName",
          "principalType",
        ],
      }
    );

    const processLinkData = new NodejsFunction(
      this,
      name(buildConfig, "processLinkDataFunction"),
      {
        runtime: Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        entry: join(
          __dirname,
          "../../../",
          "lib",
          "lambda-functions",
          "upgrade-to-v303",
          "src",
          "processLinkData.ts"
        ),
        bundling: {
          minify: true,
        },
      }
    );

    /** Log group to attach to upgrade state machine for capturing logs */
    const upgradeSMLogGroup = new LogGroup(
      this,
      name(buildConfig, "upgradeSMLogGroup"),
      {
        retention: RetentionDays.ONE_MONTH,
      }
    );

    const upgradeSMRole = new Role(this, name(buildConfig, "upgradeSMRole"), {
      assumedBy: new ServicePrincipal("states.amazonaws.com"),
    });
    upgradeSMRole.addToPrincipalPolicy(
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

    tablesKey.grantEncryptDecrypt(upgradeSMRole);
    bucketKey.grantEncryptDecrypt(upgradeSMRole);
    artefactsBucket.grantReadWrite(upgradeSMRole);
    linksTable.grantReadWriteData(upgradeSMRole);
    processLinkData.grantInvoke(upgradeSMRole);

    const upgradeV303SM = new CfnStateMachine(
      this,
      name(buildConfig, "upgradeV303SM"),
      {
        roleArn: upgradeSMRole.roleArn,
        definitionString: JSON.stringify(upgradeV303SMJson),
        stateMachineName: name(buildConfig, "upgradeV303SM"),
        loggingConfiguration: {
          destinations: [
            {
              cloudWatchLogsLogGroup: {
                logGroupArn: upgradeSMLogGroup.logGroupArn,
              },
            },
          ],
          includeExecutionData: true,
          level: "ALL",
        },
      }
    );

    upgradeV303SM.node.addDependency(upgradeSMRole);

    const triggerUpgradeSM = new NodejsFunction(
      this,
      name(buildConfig, `triggerUpgradeSM`),
      {
        runtime: Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        functionName: name(buildConfig, `triggerUpgradeSM`),
        layers: [nodeJsLayer],
        entry: join(
          __dirname,
          "../../../",
          "lib",
          "lambda-functions",
          "upgrade-to-v303",
          "src",
          "triggerV303SM.ts"
        ),
        bundling: {
          externalModules: ["@aws-sdk/client-sfn", "uuid"],
          minify: true,
        },
        environment: {
          functionLogMode: buildConfig.Parameters.FunctionLogMode,
        },
      }
    );

    triggerUpgradeSM.addToRolePolicy(
      new PolicyStatement({
        resources: [upgradeV303SM.ref],
        actions: ["states:StartExecution"],
      })
    );

    const updateCustomResource = new NodejsFunction(
      this,
      name(buildConfig, `updateCustomResource`),
      {
        runtime: Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        functionName: name(buildConfig, `updateCustomResource`),
        layers: [nodeJsLayer],
        entry: join(
          __dirname,
          "../../../",
          "lib",
          "lambda-functions",
          "upgrade-to-v303",
          "src",
          "update-custom-resource.ts"
        ),
        bundling: {
          externalModules: ["@aws-sdk/client-sfn", "uuid"],
          minify: true,
        },
        environment: {
          functionLogMode: buildConfig.Parameters.FunctionLogMode,
        },
      }
    );

    updateCustomResource.addToRolePolicy(
      new PolicyStatement({
        resources: ["*"],
        actions: ["states:DescribeExecution"],
      })
    );

    const upgradeV303Provider = new Provider(
      this,
      name(buildConfig, "upgradeV303Provider"),
      {
        onEventHandler: triggerUpgradeSM,
        isCompleteHandler: updateCustomResource,
        queryInterval: Duration.seconds(5),
        totalTimeout: Duration.minutes(120),
      }
    );

    const upgradeV303Resource = new CustomResource(
      this,
      name(buildConfig, "upgradeV303Resource"),
      {
        serviceToken: upgradeV303Provider.serviceToken,
        properties: {
          PhysicalResourceId: name(buildConfig, "upgradeV303Resource"),
          processLinksFunctionName: processLinkData.functionName,
          upgradeV303SMArn: upgradeV303SM.ref,
          artefactsBucketName: artefactsBucket.bucketName,
          linksTableName: linksTable.tableName,
        },
      }
    );

    upgradeV303Resource.node.addDependency(triggerUpgradeSM);
    upgradeV303Resource.node.addDependency(updateCustomResource);
    upgradeV303Resource.node.addDependency(processLinkData);

    /** CloudWatch insights query to debug errors, if any */
    new CfnQueryDefinition(this, name(buildConfig, "upgradeV303-errors"), {
      name: name(buildConfig, "upgradeV303-errors"),
      queryString:
        "filter @message like 'solutionError' and details.name not like 'Catchall'| sort id asc",
      logGroupNames: [upgradeSMLogGroup.logGroupName],
    });
  }
}

/**
 * Construct used for discovering SSO objects, i.e. permission sets and account
 * assignments. This construct is to be run in target account + region. It will
 * deploy a collection of lambda functions.
 */
import { ITable, Table } from "aws-cdk-lib/aws-dynamodb";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { IKey, Key } from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { SnsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Bucket, IBucket } from "aws-cdk-lib/aws-s3";
import { ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";
import { SSMParamReader } from "./ssm-param-reader";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class SSOObjectsDiscoveryPart2 extends Construct {
  public readonly nodeJsLayer: ILayerVersion;
  public readonly accountAssignmentImportTopic: ITopic;
  public readonly permissionSetImportTopic: ITopic;
  public readonly currentConfigSMInvokeRoleArn: string;
  public readonly currentConfigSMDescribeRoleArn: string;
  public readonly importedPermissionSetHandlerSSOAPIRoleArn: string;
  public readonly importedSsoArtefactsBucket: IBucket;
  public readonly importedPsTable: ITable;
  public readonly importedPsArnTable: ITable;
  public readonly importedLinksTable: ITable;
  public readonly importedProvisionedLinksTable: ITable;
  public readonly importedddbTablesKey: IKey;
  public readonly importAccountAssignmentHandler: NodejsFunction;
  public readonly importPermissionSetHandler: NodejsFunction;

  constructor(scope: Construct, id: string, buildConfig: BuildConfig) {
    super(scope, id);

    /**
     * Import resources created in part 1 (SSO account + region) as local
     * resources so that they could be used in part 2 (target account + region)
     * We use either native SSM CDK construct / custom SSM reader construct
     * depending on if the paraemter is local to target account/not
     */

    this.nodeJsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      name(buildConfig, "importedNodeJsLayerVersion"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "nodeJsLayerVersionArn")
      ).toString()
    );

    this.importedddbTablesKey = Key.fromKeyArn(
      this,
      name(buildConfig, "importedDdbTablesKey"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "ddbTablesKeyArn")
      )
    );

    this.currentConfigSMInvokeRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "ssoListRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "ssoList-ssoapi-roleArn",
      }
    ).paramValue;

    this.currentConfigSMDescribeRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "currentConfigSMDescribeRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "smDescribe-ssoapi-roleArn",
      }
    ).paramValue;

    this.importedPermissionSetHandlerSSOAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "importedPermissionSetHandlerSSOAPIRoleArn"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "permissionSetHandler-ssoapi-roleArn",
      }
    ).paramValue;

    this.accountAssignmentImportTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "accountAssignmentImportTopic"),
      new SSMParamReader(
        this,
        name(buildConfig, "accountAssignmentImportTopicArnReader"),
        buildConfig,
        {
          ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
          ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          ParamNameKey: "accountAssignmentImportTopicArn",
        }
      ).paramValue
    );

    this.permissionSetImportTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "permissionSetImportTopic"),
      new SSMParamReader(
        this,
        name(buildConfig, "permissionSetImportTopicArnReader"),
        buildConfig,
        {
          ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
          ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          ParamNameKey: "permissionSetImportTopicArn",
        }
      ).paramValue
    );

    this.importedSsoArtefactsBucket = Bucket.fromBucketName(
      this,
      name(buildConfig, "importedSsoArtefactsBucket"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "ssoArtefactsBucketName")
      )
    );

    this.importedPsTable = Table.fromTableAttributes(
      this,
      name(buildConfig, "importedPsTable"),
      {
        tableArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "permissionSetTableArn")
        ),
      }
    );

    this.importedPsArnTable = Table.fromTableArn(
      this,
      name(buildConfig, "importedPsArnTable"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "permissionSetArnTableArn")
      )
    );

    this.importedLinksTable = Table.fromTableAttributes(
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

    this.importedProvisionedLinksTable = Table.fromTableAttributes(
      this,
      name(buildConfig, "importedProvisionedLinksTable"),
      {
        tableArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "provisionedLinksTableArn")
        ),
        globalIndexes: ["tagKeyLookUp"],
      }
    );

    /**
     * Define the lambda handlers that would subscribe to cross account topics
     * used in part 1 and consume the SSO object payload sent by the discovery
     * state machines
     */
    this.importAccountAssignmentHandler = new NodejsFunction(
      this,
      name(buildConfig, `importAccountAssignmentHandler`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        functionName: name(buildConfig, `importAccountAssignmentHandler`),
        layers: [this.nodeJsLayer],
        entry: join(
          __dirname,
          "../../",
          "lib",
          "lambda-functions",
          "current-config-handlers",
          "src",
          "import-account-assignments.ts"
        ),
        bundling: {
          externalModules: [
            "uuid",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-s3",
            "@aws-sdk/client-ssm",
            "@aws-sdk/client-sqs",
          ],
          minify: true,
        },
        environment: {
          linksTableName: this.importedLinksTable.tableName,
          provisionedLinksTableName:
            this.importedProvisionedLinksTable.tableName,
          artefactsBucketName: this.importedSsoArtefactsBucket.bucketName,
          configEnv: buildConfig.Environment,
        },
      }
    );

    /**
     * Grant the lambda handler permissions on the tables and keys for importing
     * data and managing the required SSO state
     */

    this.importedddbTablesKey.grantEncryptDecrypt(
      this.importAccountAssignmentHandler
    );

    this.importedLinksTable.grantReadWriteData(
      this.importAccountAssignmentHandler
    );
    this.importedProvisionedLinksTable.grantReadWriteData(
      this.importAccountAssignmentHandler
    );

    this.importedSsoArtefactsBucket.grantReadWrite(
      this.importAccountAssignmentHandler
    );

    /** Subscribe the lambda to the cross account SNS topic */
    this.importAccountAssignmentHandler.addEventSource(
      new SnsEventSource(this.accountAssignmentImportTopic)
    );

    /**
     * Define the lambda handlers that would subscribe to cross account topics
     * used in part 1 and consume the SSO object payload sent by the discovery
     * state machines
     */

    this.importPermissionSetHandler = new NodejsFunction(
      this,
      name(buildConfig, `importPermissionSetHandler`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        functionName: name(buildConfig, `importPermissionSetHandler`),
        layers: [this.nodeJsLayer],
        entry: join(
          __dirname,
          "../../",
          "lib",
          "lambda-functions",
          "current-config-handlers",
          "src",
          "import-permission-sets.ts"
        ),
        bundling: {
          externalModules: [
            "uuid",
            "json-diff",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/client-sso-admin",
            "@aws-sdk/credential-providers",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-s3",
            "@aws-sdk/client-ssm",
            "@aws-sdk/client-sqs",
          ],
          minify: true,
        },
        environment: {
          permissionSetTableName: this.importedPsTable.tableName,
          permissionSetArnTableName: this.importedPsArnTable.tableName,
          SSOAPIRoleArn: this.importedPermissionSetHandlerSSOAPIRoleArn,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          artefactsBucketName: this.importedSsoArtefactsBucket.bucketName,
          configEnv: buildConfig.Environment,
        },
      }
    );
    /**
     * Grant the lambda handler permissions on the tables and keys for importing
     * data and managing the required SSO state
     */
    this.importedddbTablesKey.grantEncryptDecrypt(
      this.importPermissionSetHandler
    );

    this.importedPsTable.grantReadWriteData(this.importPermissionSetHandler);
    this.importedPsArnTable.grantReadWriteData(this.importPermissionSetHandler);

    this.importedSsoArtefactsBucket.grantReadWrite(
      this.importPermissionSetHandler
    );

    if (this.importPermissionSetHandler.role) {
      this.importPermissionSetHandler.addToRolePolicy(
        new PolicyStatement({
          resources: [this.importedPermissionSetHandlerSSOAPIRoleArn],
          actions: ["sts:AssumeRole"],
        })
      );
    }

    /** Subscribe the lambda to the cross account SNS topic */
    this.importPermissionSetHandler.addEventSource(
      new SnsEventSource(this.permissionSetImportTopic)
    );
  }
}

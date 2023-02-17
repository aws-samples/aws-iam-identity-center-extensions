/**
 * This construct allows read the non-deterministic values of resources created
 * in preSolutions stack. This is to avoid creating circular dependencies
 * between preSolutions and ssoImportArtefacts-part2 through the default CFN
 * exports. We circumvent that by relying on AWS SSM parameter store based
 * reads
 */

import { ITable, Table } from "aws-cdk-lib/aws-dynamodb";
import { IKey, Key } from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { ILayerVersion } from "aws-cdk-lib/aws-lambda";
import { Bucket, IBucket } from "aws-cdk-lib/aws-s3";
import { ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";
import { SSMParamReader } from "./ssm-param-reader";
import { name } from "./helpers";

export class ImportArtefacts extends Construct {
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
  public readonly importCmpAndPbFunctionArn: string;

  constructor(scope: Construct, id: string, buildConfig: BuildConfig) {
    super(scope, id);

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

    this.importCmpAndPbFunctionArn = new SSMParamReader(
      this,
      name(buildConfig, "importCmpAndPbFunctionArn"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "importCmpAndPbArn",
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
  }
}

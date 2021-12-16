/*
Construct to specifically read values from preSolutions
Artefact stack. This is to avoid creating a circular 
dependency through CFN exports and instead rely on SSM paramter
store based reads
*/

import { ITable, Table } from "aws-cdk-lib/aws-dynamodb";
import { IKey, Key } from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { IQueue, Queue } from "aws-cdk-lib/aws-sqs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";
import { SSMParamReader } from "./ssm-param-reader";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class FetchCrossStackValues extends Construct {
  public readonly errorNotificationsTopic: ITopic;
  public readonly ssoGroupEventNotificationsTopic: ITopic;
  public readonly orgEventsNotificationsTopic: ITopic;
  public readonly processTargetAccountSMTopic: ITopic;
  public readonly linkProcessorTopic: ITopic;
  public readonly nodeJsLayer: lambda.ILayerVersion;
  public readonly linksTable: ITable;
  public readonly provisionedLinksTable: ITable;
  public readonly permissionSetTable: ITable;
  public readonly permissionSetArnTable: ITable;
  public readonly snsTopicsKey: IKey;
  public readonly ddbTablesKey: IKey;
  public readonly queuesKey: IKey;
  public readonly linkManagerQueue: IQueue;
  public readonly permissionSetHandlerSSOAPIRoleArn: string;
  public readonly linkManagerHandlerSSOAPIRoleArn: string;
  public readonly listInstancesSSOAPIRoleArn: string;
  public readonly listGroupsIdentityStoreAPIRoleArn: string;
  public readonly processTargetAccountSMInvokeRoleArn: string;
  public readonly waiterHandlerSSOAPIRoleArn: string;

  constructor(scope: Construct, id: string, buildConfig: BuildConfig) {
    super(scope, id);

    this.errorNotificationsTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "importedErrorNotificationsTopic"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "errorNotificationsTopicArn")
      )
    );

    this.ssoGroupEventNotificationsTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "importedssoGroupEventNotificationsTopic"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "ssoGroupEventNotificationsTopicArn")
      )
    );

    this.orgEventsNotificationsTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "importedOrgEventNotificationsTopic"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "orgEventsNotificationsTopicArn")
      )
    );

    this.processTargetAccountSMTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "importedprocessTargetAccountSMTopic"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "processTargetAccountSMTopicArn")
      )
    );

    this.linkProcessorTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "importedLinkProcessorTopic"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "linkProcessorTopicArn")
      )
    );

    this.linkManagerQueue = Queue.fromQueueArn(
      this,
      name(buildConfig, "importedLinkManagerQueue"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "linkQueueArn")
      )
    );

    this.nodeJsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      name(buildConfig, "importedNodeJsLayerVersion"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "nodeJsLayerVersionArn")
      ).toString()
    );

    this.linksTable = Table.fromTableAttributes(
      this,
      name(buildConfig, "importedLinksTable"),
      {
        tableArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "linksTableArn")
        ),
        tableStreamArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "linksTableStreamArn")
        ),
        globalIndexes: ["awsEntityData", "groupName", "permissionSetName"],
      }
    );

    this.provisionedLinksTable = Table.fromTableAttributes(
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

    this.permissionSetTable = Table.fromTableAttributes(
      this,
      name(buildConfig, "importedPermissionSetTable"),
      {
        tableArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "permissionSetTableArn")
        ),
        tableStreamArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "permissionSetTableStreamArn")
        ),
      }
    );

    this.permissionSetArnTable = Table.fromTableArn(
      this,
      name(buildConfig, "importedPermissionSetArnTable"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "permissionSetArnTableArn")
      )
    );

    this.snsTopicsKey = Key.fromKeyArn(
      this,
      name(buildConfig, "importedSnsTopicsKey"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "snsTopicsKeyArn")
      )
    );
    this.ddbTablesKey = Key.fromKeyArn(
      this,
      name(buildConfig, "importedDdbTablesKey"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "ddbTablesKeyArn")
      )
    );

    this.queuesKey = Key.fromKeyArn(
      this,
      name(buildConfig, "importedQueuesKey"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "queuesKeyArn")
      )
    );

    this.permissionSetHandlerSSOAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "permissionSetHandlerSSOAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "permissionSetHandler-ssoapi-roleArn",
        LambdaLayers: this.nodeJsLayer,
      }
    ).paramValue;

    this.linkManagerHandlerSSOAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "linkManagerHandlerSSOAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "linkManagerHandler-ssoapi-roleArn",
        LambdaLayers: this.nodeJsLayer,
      }
    ).paramValue;

    this.listInstancesSSOAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "listInstancesSSOAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "listInstances-ssoapi-roleArn",
        LambdaLayers: this.nodeJsLayer,
      }
    ).paramValue;

    this.listGroupsIdentityStoreAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "listGroupsIdentityStoreAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "listgroups-identitystoreapi-roleArn",
        LambdaLayers: this.nodeJsLayer,
      }
    ).paramValue;

    this.processTargetAccountSMInvokeRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "processTargetAccountSMInvokeRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.OrgMainAccountId,
        ParamRegion: "us-east-1", // Organizations discovery can only be done in us-east-1, hence the step functions and related roles are declared in that region
        ParamNameKey: "processTargetAccountSMInvoke-orgapi-roleArn",
        LambdaLayers: this.nodeJsLayer,
      }
    ).paramValue;

    this.waiterHandlerSSOAPIRoleArn = StringParameter.valueForStringParameter(
      this,
      name(buildConfig, "waiterHandlerSSOAPIRoleArn")
    );
  }
}

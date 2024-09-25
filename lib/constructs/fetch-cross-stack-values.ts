/**
 * This construct allows read the non-deterministic values of resources created
 * in preSolutions stack. This is to avoid creating circular dependencies
 * between preSolutions and Solutions stack through the default CFN exports. We
 * circumvent that by relying on AWS SSM parameter store based reads
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
  public readonly ssoUserEventNotificationsTopic: ITopic;
  public readonly orgEventsNotificationsTopic: ITopic;
  public readonly processTargetAccountSMTopic: ITopic;
  public readonly linkProcessorTopic: ITopic;
  public readonly permissionSetProcessorTopic: ITopic;
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
  public readonly orgListSMRoleArn: string;
  public readonly orgListParentsRoleArn: string;
  public readonly waiterHandlerSSOAPIRoleArn: string;
  public readonly iteratorArn: string;
  public readonly customerManagedPolicyProcessOpArn: string;
  public readonly managedPolicyProcessOpArn: string;
  public readonly ssoMpRoleArn: string;

  constructor(scope: Construct, id: string, buildConfig: BuildConfig) {
    super(scope, id);

    this.errorNotificationsTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "importedErrorNotificationsTopic"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "errorNotificationsTopicArn"),
      ),
    );

    this.ssoGroupEventNotificationsTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "importedssoGroupEventNotificationsTopic"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "ssoGroupEventNotificationsTopicArn"),
      ),
    );

    this.ssoUserEventNotificationsTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "importedssoUserEventNotificationsTopic"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "ssoUserEventsNotificationsTopicArn"),
      ),
    );

    this.orgEventsNotificationsTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "importedOrgEventNotificationsTopic"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "importedOrgEventsNotificationsTopicArn"),
      ),
    );

    this.processTargetAccountSMTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "importedprocessTargetAccountSMTopic"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "importedProcessTargetAccountSMTopicArn"),
      ),
    );

    this.linkProcessorTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "importedLinkProcessorTopic"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "linkProcessorTopicArn"),
      ),
    );

    this.permissionSetProcessorTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "importedPermissionSetProcessorTopic"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "permissionSetProcessorTopicArn"),
      ),
    );

    this.linkManagerQueue = Queue.fromQueueArn(
      this,
      name(buildConfig, "importedLinkManagerQueue"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "linkQueueArn"),
      ),
    );

    this.nodeJsLayer = lambda.LayerVersion.fromLayerVersionArn(
      this,
      name(buildConfig, "importedNodeJsLayerVersion"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "nodeJsLayerVersionArn"),
      ).toString(),
    );

    this.linksTable = Table.fromTableAttributes(
      this,
      name(buildConfig, "importedLinksTable"),
      {
        tableArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "linksTableArn"),
        ),
        globalIndexes: [
          "awsEntityData",
          "principalName",
          "permissionSetName",
          "principalType",
        ],
      },
    );

    this.provisionedLinksTable = Table.fromTableAttributes(
      this,
      name(buildConfig, "importedProvisionedLinksTable"),
      {
        tableArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "provisionedLinksTableArn"),
        ),
        globalIndexes: ["tagKeyLookUp"],
      },
    );

    this.permissionSetTable = Table.fromTableAttributes(
      this,
      name(buildConfig, "importedPermissionSetTable"),
      {
        tableArn: StringParameter.valueForStringParameter(
          this,
          name(buildConfig, "permissionSetTableArn"),
        ),
      },
    );

    this.permissionSetArnTable = Table.fromTableArn(
      this,
      name(buildConfig, "importedPermissionSetArnTable"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "permissionSetArnTableArn"),
      ),
    );

    this.snsTopicsKey = Key.fromKeyArn(
      this,
      name(buildConfig, "importedSnsTopicsKey"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "snsTopicsKeyArn"),
      ),
    );
    this.ddbTablesKey = Key.fromKeyArn(
      this,
      name(buildConfig, "importedDdbTablesKey"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "ddbTablesKeyArn"),
      ),
    );

    this.queuesKey = Key.fromKeyArn(
      this,
      name(buildConfig, "importedQueuesKey"),
      StringParameter.valueForStringParameter(
        this,
        name(buildConfig, "queuesKeyArn"),
      ),
    );

    this.permissionSetHandlerSSOAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "permissionSetHandlerSSOAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "permissionSetHandler-ssoapi-roleArn",
      },
    ).paramValue;

    this.linkManagerHandlerSSOAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "linkManagerHandlerSSOAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "linkManagerHandler-ssoapi-roleArn",
      },
    ).paramValue;

    this.listInstancesSSOAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "listInstancesSSOAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "listInstances-ssoapi-roleArn",
      },
    ).paramValue;

    this.listGroupsIdentityStoreAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "listGroupsIdentityStoreAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "listPrincipals-identitystoreapi-roleArn",
      },
    ).paramValue;

    this.orgListSMRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "orgListSMRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.OrgMainAccountId,
        ParamRegion: "us-east-1", // Organizations discovery can only be done in us-east-1, hence the step functions and related roles are declared in that region
        ParamNameKey: "orgListSM-orgapi-roleArn",
      },
    ).paramValue;

    this.orgListParentsRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "orgListParentsRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.OrgMainAccountId,
        ParamRegion: "us-east-1",
        /**
         * Organizations discovery can only be done in us-east-1, hence the step
         * functions and related roles are declared in that region
         */ ParamNameKey: "orgListParents-orgapi-roleArn",
      },
    ).paramValue;

    this.waiterHandlerSSOAPIRoleArn = StringParameter.valueForStringParameter(
      this,
      name(buildConfig, "waiterHandlerSSOAPIRoleArn"),
    );

    this.iteratorArn = new SSMParamReader(
      this,
      name(buildConfig, "iteratorArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "iteratorArn",
      },
    ).paramValue;

    this.customerManagedPolicyProcessOpArn = new SSMParamReader(
      this,
      name(buildConfig, "customerManagedPolicyProcessOpArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "customerManagedPolicyProcessOpArn",
      },
    ).paramValue;

    this.managedPolicyProcessOpArn = new SSMParamReader(
      this,
      name(buildConfig, "managedPolicyProcessOpArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "managedPolicyProcessOpArn",
      },
    ).paramValue;

    this.ssoMpRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "ssoMpRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "ssoMp-ssoapi-roleArn",
      },
    ).paramValue;
  }
}

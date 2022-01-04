/*
Utility construct in solution artefacts stack
that allows shareable resources
*/

import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Key } from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";
import { SSMParamReader } from "./ssm-param-reader";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface UtilityProps {
  readonly errorNotificationsTopic: Topic;
  readonly nodeJsLayer: lambda.LayerVersion;
  readonly provisionedLinksTable: Table;
  readonly waiterHandlerSSOAPIRoleArn: string;
  readonly snsTopicsKey: Key;
  readonly linkManagerQueueUrl: string;
}

export class Utility extends Construct {
  public readonly orgEventsNotificationsTopic: ITopic;
  public readonly ssoGroupEventsNotificationsTopic: ITopic;
  public readonly ssoUserEventsNotificationsTopic: ITopic;
  public readonly processTargetAccountSMTopic: ITopic;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    utilityProps: UtilityProps
  ) {
    super(scope, id);

    this.orgEventsNotificationsTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "orgEvenstNotificationsTopic"),
      new SSMParamReader(
        this,
        name(buildConfig, "orgEventsNotificationTopicArnReader"),
        buildConfig,
        {
          ParamAccountId: buildConfig.PipelineSettings.OrgMainAccountId,
          ParamRegion: "us-east-1",
          ParamNameKey: "orgEventsNotificationsTopicArn",
          LambdaLayers: utilityProps.nodeJsLayer,
        }
      ).paramValue
    );

    this.ssoGroupEventsNotificationsTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "ssoGroupEventsNotificationsTopic"),
      new SSMParamReader(
        this,
        name(buildConfig, "ssoGroupEventsNotificationTopicArnReader"),
        buildConfig,
        {
          ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
          ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          ParamNameKey: "ssoGroupEventsNotificationTopicArn",
          LambdaLayers: utilityProps.nodeJsLayer,
        }
      ).paramValue
    );

    this.ssoUserEventsNotificationsTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "ssoUserEventsNotificationsTopic"),
      new SSMParamReader(
        this,
        name(buildConfig, "ssoUserEventsNotificationsTopicArnReader"),
        buildConfig,
        {
          ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
          ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          ParamNameKey: "ssoUserEventsNotificationTopicArn",
          LambdaLayers: utilityProps.nodeJsLayer,
        }
      ).paramValue
    );

    this.processTargetAccountSMTopic = Topic.fromTopicArn(
      this,
      name(buildConfig, "processTargetAccountSMTopic"),
      new SSMParamReader(
        this,
        name(buildConfig, "processTargetAccountSMTopicArnReader"),
        buildConfig,
        {
          ParamAccountId: buildConfig.PipelineSettings.OrgMainAccountId,
          ParamRegion: "us-east-1",
          ParamNameKey: "processTargetAccountSMTopicArn",
          LambdaLayers: utilityProps.nodeJsLayer,
        }
      ).paramValue
    );

    new StringParameter(
      this,
      name(buildConfig, "processTargetAccountSMTopicArn"),
      {
        parameterName: name(buildConfig, "processTargetAccountSMTopicArn"),
        stringValue: this.processTargetAccountSMTopic.topicArn,
      }
    );

    new StringParameter(
      this,
      name(buildConfig, "ssoGroupEventNotificationsTopicArn"),
      {
        parameterName: name(buildConfig, "ssoGroupEventNotificationsTopicArn"),
        stringValue: this.ssoGroupEventsNotificationsTopic.topicArn,
      }
    );

    new StringParameter(
      this,
      name(buildConfig, "ssoUserEventsNotificationsTopicArn"),
      {
        parameterName: name(buildConfig, "ssoUserEventsNotificationsTopicArn"),
        stringValue: this.ssoUserEventsNotificationsTopic.topicArn,
      }
    );

    new StringParameter(
      this,
      name(buildConfig, "orgEventsNotificationsTopicArn"),
      {
        parameterName: name(buildConfig, "orgEventsNotificationsTopicArn"),
        stringValue: this.orgEventsNotificationsTopic.topicArn,
      }
    );
  }
}

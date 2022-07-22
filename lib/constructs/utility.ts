/** Utility construct in solution artefacts stack that allows shareable resources */

import { ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";
import { SSMParamReader } from "./ssm-param-reader";
import { name } from "./helpers";

export class Utility extends Construct {
  public readonly orgEventsNotificationsTopic: ITopic;
  public readonly ssoGroupEventsNotificationsTopic: ITopic;
  public readonly ssoUserEventsNotificationsTopic: ITopic;
  public readonly processTargetAccountSMTopic: ITopic;

  constructor(scope: Construct, id: string, buildConfig: BuildConfig) {
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
        }
      ).paramValue
    );

    new StringParameter(
      this,
      name(buildConfig, "importedProcessTargetAccountSMTopicArn"),
      {
        parameterName: name(
          buildConfig,
          "importedProcessTargetAccountSMTopicArn"
        ),
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
        parameterName: name(
          buildConfig,
          "importedOrgEventsNotificationsTopicArn"
        ),
        stringValue: this.orgEventsNotificationsTopic.topicArn,
      }
    );
  }
}

/*
Utility construct in solution artefacts stack
that allows shareable resources
*/

import { Table } from "aws-cdk-lib/aws-dynamodb";
import { Key } from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SnsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";
import { SSMParamReader } from "./ssm-param-reader";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface UtilityProps {
  readonly errorNotificationsTopic: Topic;
  readonly pythonLayer: lambda.LayerVersion;
  readonly nodeJsLayer: lambda.LayerVersion;
  readonly provisionedLinksTable: Table;
  readonly waiterHandlerSSOAPIRoleArn: string;
  readonly snsTopicsKey: Key;
}

export class Utility extends Construct {
  public readonly orgEventsNotificationsTopic: ITopic;
  public readonly ssoGroupEventsNotificationsTopic: ITopic;
  public readonly processTargetAccountSMTopic: ITopic;
  public readonly waiterHandler: lambda.Function;
  public readonly waiterHandlerNotificationsTopic: Topic;

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
        name(buildConfig, "ssoEventsNotificationTopicArnReader"),
        buildConfig,
        {
          ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
          ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          ParamNameKey: "ssoEventsNotificationTopicArn",
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

    this.waiterHandler = new lambda.Function(
      this,
      name(buildConfig, "waiterHandler"),
      {
        runtime: lambda.Runtime.PYTHON_3_8,
        handler: "ssoAdminAPIWaiters.lambda_handler",
        functionName: name(buildConfig, "waiterHandler"),
        code: lambda.Code.fromAsset(
          join(__dirname, "../", "lambda-functions", "custom-waiters", "src")
        ),
        layers: [utilityProps.pythonLayer],
        environment: {
          errorNotificationsTopicArn:
            utilityProps.errorNotificationsTopic.topicArn,
          provisionedLinksTable: utilityProps.provisionedLinksTable.tableName,
          SSOAPIRoleArn: utilityProps.waiterHandlerSSOAPIRoleArn,
          SSOServiceAccountRegion:
            buildConfig.PipelineSettings.SSOServiceAccountRegion,
        },
      }
    );

    this.waiterHandlerNotificationsTopic = new Topic(
      this,
      name(buildConfig, "waiterNotificationTopic"),
      {
        displayName: name(buildConfig, "waiterNotificationTopic"),
        masterKey: utilityProps.snsTopicsKey,
      }
    );

    this.waiterHandler.addEventSource(
      new SnsEventSource(this.waiterHandlerNotificationsTopic)
    );

    new StringParameter(
      this,
      name(buildConfig, "waiterHandlerNotificationsTopicArn"),
      {
        parameterName: name(buildConfig, "waiterHandlerNotificationsTopicArn"),
        stringValue: this.waiterHandlerNotificationsTopic.topicArn,
      }
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
      name(buildConfig, "orgEventsNotificationsTopicArn"),
      {
        parameterName: name(buildConfig, "orgEventsNotificationsTopicArn"),
        stringValue: this.orgEventsNotificationsTopic.topicArn,
      }
    );

    new StringParameter(this, name(buildConfig, "waiterHandlerArn"), {
      parameterName: name(buildConfig, "waiterHandlerArn"),
      stringValue: this.waiterHandler.functionArn,
    });
  }
}

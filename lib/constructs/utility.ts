/*
Utility construct in solution artefacts stack
that allows shareable resources
*/

import { Table } from "@aws-cdk/aws-dynamodb";
import { Key } from "@aws-cdk/aws-kms";
import * as lambda from "@aws-cdk/aws-lambda"; //Needed to avoid semgrep throwing up https://cwe.mitre.org/data/definitions/95.html
import { SnsEventSource } from "@aws-cdk/aws-lambda-event-sources";
import { ITopic, Topic } from "@aws-cdk/aws-sns";
import { Construct } from "@aws-cdk/core";
import * as Path from "path";
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
          Path.join(__dirname, "../", "lambda", "functions", "custom-waiters")
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
  }
}

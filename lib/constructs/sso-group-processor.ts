/*
composite construct that sets up all resources
for SSO group life cycle notifications
*/
import * as lambda from "@aws-cdk/aws-lambda"; //Needed to avoid semgrep throwing up https://cwe.mitre.org/data/definitions/95.html
import { SnsEventSource } from "@aws-cdk/aws-lambda-event-sources";
import { ITopic } from "@aws-cdk/aws-sns";
import { Construct } from "@aws-cdk/core";
import * as Path from "path";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface SSOGroupProcessorProps {
  readonly linksTableName: string;
  readonly permissionSetArnTableName: string;
  readonly groupsTableName: string;
  readonly linkManagerTopicArn: string;
  readonly errorNotificationsTopicArn: string;
  readonly nodeJsLayer: lambda.LayerVersion;
  readonly ssoGroupEventNotificationsTopic: ITopic;
  readonly listInstancesSSOAPIRoleArn: string;
  readonly processTargetAccountSMInvokeRoleArn: string;
  readonly processTargetAccountSMTopic: ITopic;
}

export class SSOGroupProcessor extends Construct {
  public readonly ssoGroupHandler: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    ssoGroupProcessorProps: SSOGroupProcessorProps
  ) {
    super(scope, id);

    this.ssoGroupHandler = new lambda.Function(
      this,
      name(buildConfig, "ssoGroupHandler"),
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: "groupsCud.handler",
        functionName: name(buildConfig, "ssoGroupHandler"),
        code: lambda.Code.fromAsset(
          Path.join(__dirname, "../", "lambda-functions", "sso-handlers", "src")
        ),
        layers: [ssoGroupProcessorProps.nodeJsLayer],
        environment: {
          DdbTable: ssoGroupProcessorProps.groupsTableName,
          permissionarntable: ssoGroupProcessorProps.permissionSetArnTableName,
          linkstable: ssoGroupProcessorProps.linksTableName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          topicArn: ssoGroupProcessorProps.linkManagerTopicArn,
          errorNotificationsTopicArn:
            ssoGroupProcessorProps.errorNotificationsTopicArn,
          SSOAPIRoleArn: ssoGroupProcessorProps.listInstancesSSOAPIRoleArn,
          processTargetAccountSMTopicArn:
            ssoGroupProcessorProps.processTargetAccountSMTopic.topicArn,
          processTargetAccountSMInvokeRoleArn:
            ssoGroupProcessorProps.processTargetAccountSMInvokeRoleArn,
          processTargetAccountSMArn: `arn:aws:states:us-east-1:${buildConfig.PipelineSettings.OrgMainAccountId}:stateMachine:${buildConfig.Environment}-processTargetAccountSM`,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        },
      }
    );

    this.ssoGroupHandler.addEventSource(
      new SnsEventSource(ssoGroupProcessorProps.ssoGroupEventNotificationsTopic)
    );
  }
}

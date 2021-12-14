/*
composite construct that sets up all resources
for SSO group life cycle notifications
*/
import { ILayerVersion, Runtime } from "aws-cdk-lib/aws-lambda"; // Importing external resources in CDK would use interfaces and not base objects
import { SnsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ITopic } from "aws-cdk-lib/aws-sns"; // Importing external resources in CDK would use interfaces and not base objects
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface SSOGroupProcessorProps {
  readonly linksTableName: string;
  readonly permissionSetArnTableName: string;
  readonly groupsTableName: string;
  readonly linkQueueUrl: string;
  readonly errorNotificationsTopicArn: string;
  readonly nodeJsLayer: ILayerVersion;
  readonly ssoGroupEventNotificationsTopic: ITopic;
  readonly listInstancesSSOAPIRoleArn: string;
  readonly processTargetAccountSMInvokeRoleArn: string;
  readonly processTargetAccountSMTopic: ITopic;
}

export class SSOGroupProcessor extends Construct {
  public readonly ssoGroupHandler: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    ssoGroupProcessorProps: SSOGroupProcessorProps
  ) {
    super(scope, id);

    this.ssoGroupHandler = new NodejsFunction(
      this,
      name(buildConfig, "ssoGroupHandler"),
      {
        runtime: Runtime.NODEJS_14_X,
        functionName: name(buildConfig, "ssoGroupHandler"),
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "application-handlers",
          "src",
          "groupsCud.ts"
        ),
        bundling: {
          externalModules: [
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-sns",
            "@aws-sdk/client-sfn",
            "@aws-sdk/client-sso-admin",
            "@aws-sdk/credential-providers",
            "@aws-sdk/client-sqs",
            "uuid",
          ],
          minify: true,
        },
        layers: [ssoGroupProcessorProps.nodeJsLayer],
        environment: {
          DdbTable: ssoGroupProcessorProps.groupsTableName,
          permissionarntable: ssoGroupProcessorProps.permissionSetArnTableName,
          linkstable: ssoGroupProcessorProps.linksTableName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          linkQueueUrl: ssoGroupProcessorProps.linkQueueUrl,
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

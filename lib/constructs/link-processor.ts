/*
composite construct that sets up all resources
for account assignments creation/deletion
*/

import { Duration } from "aws-cdk-lib";
import { ITable } from "aws-cdk-lib/aws-dynamodb"; // Importing external resources in CDK would use interfaces and not base objects
import { ILayerVersion, Runtime } from "aws-cdk-lib/aws-lambda"; // Importing external resources in CDK would use interfaces and not base objects
import {
  SnsEventSource,
  SqsEventSource,
} from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ITopic } from "aws-cdk-lib/aws-sns";
import { IQueue } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface LinkProcessProps {
  readonly linksTable: ITable;
  readonly provisionedLinksTableName: string;
  readonly permissionSetArnTableName: string;
  readonly errorNotificationsTopic: ITopic;
  readonly linkManagerHandlerSSOAPIRoleArn: string;
  readonly waiterHandlerSSOAPIRoleArn: string;
  readonly listInstancesSSOAPIRoleArn: string;
  readonly listGroupsIdentityStoreAPIRoleArn: string;
  readonly orgListSMRoleArn: string;
  readonly processTargetAccountSMTopic: ITopic;
  readonly linkProcessorTopic: ITopic;
  readonly nodeJsLayer: ILayerVersion;
  readonly linkManagerQueue: IQueue;
}

export class LinkProcessor extends Construct {
  public readonly linkManagerHandler: NodejsFunction;
  public readonly linkTopicProcessor: NodejsFunction;
  public readonly processTargetAccountSMListenerHandler: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    linkprocessProps: LinkProcessProps
  ) {
    super(scope, id);

    this.linkManagerHandler = new NodejsFunction(
      this,
      name(buildConfig, "linkManagerHandler"),
      {
        functionName: name(buildConfig, "linkManagerHandler"),
        runtime: Runtime.NODEJS_14_X,
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "application-handlers",
          "src",
          "linkManager.ts"
        ),
        bundling: {
          externalModules: [
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-sns",
            "@aws-sdk/client-sso-admin",
            "@aws-sdk/credential-providers",
            "@aws-sdk/util-waiter",
            "uuid",
          ],
          minify: true,
        },
        layers: [linkprocessProps.nodeJsLayer],
        environment: {
          provisionedLinksTable: linkprocessProps.provisionedLinksTableName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          errorNotificationsTopicArn:
            linkprocessProps.errorNotificationsTopic.topicArn,
          payerAccount: buildConfig.PipelineSettings.OrgMainAccountId,
          SSOAPIRoleArn: linkprocessProps.linkManagerHandlerSSOAPIRoleArn,
          waiterHandlerSSOAPIRoleArn:
            linkprocessProps.waiterHandlerSSOAPIRoleArn,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        },
        timeout: Duration.minutes(11), //aggressive timeout to accommodate SSO Admin API's workflow based logic
      }
    );

    this.linkManagerHandler.addEventSource(
      new SqsEventSource(linkprocessProps.linkManagerQueue, {
        batchSize: 10,
      })
    );

    this.processTargetAccountSMListenerHandler = new NodejsFunction(
      this,
      name(buildConfig, "processTargetAccountSMListenerHandler"),
      {
        runtime: Runtime.NODEJS_14_X,
        functionName: name(
          buildConfig,
          "processTargetAccountSMListenerHandler"
        ),
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "application-handlers",
          "src",
          "processTargetAccountSMListener.ts"
        ),
        bundling: {
          externalModules: ["@aws-sdk/client-sns", "@aws-sdk/client-sqs"],
          minify: true,
        },
        layers: [linkprocessProps.nodeJsLayer],
        environment: {
          linkQueueUrl: linkprocessProps.linkManagerQueue.queueUrl,
          errorNotificationsTopicArn:
            linkprocessProps.errorNotificationsTopic.topicArn,
        },
      }
    );

    this.processTargetAccountSMListenerHandler.addEventSource(
      new SnsEventSource(linkprocessProps.processTargetAccountSMTopic)
    );

    this.linkTopicProcessor = new NodejsFunction(
      this,
      name(buildConfig, "linkTopicProcessor"),
      {
        functionName: name(buildConfig, "linkTopicProcessor"),
        runtime: Runtime.NODEJS_14_X,
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "application-handlers",
          "src",
          "linkTopicProcessor.ts"
        ),
        bundling: {
          externalModules: [
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-sns",
            "@aws-sdk/client-sfn",
            "@aws-sdk/client-sso-admin",
            "@aws-sdk/credential-providers",
            "@aws-sdk/client-identitystore",
            "@aws-sdk/client-sqs",
          ],
          minify: true,
        },
        layers: [linkprocessProps.nodeJsLayer],
        environment: {
          linkQueueUrl: linkprocessProps.linkManagerQueue.queueUrl,
          permissionSetArnTable: linkprocessProps.permissionSetArnTableName,
          errorNotificationsTopicArn:
            linkprocessProps.errorNotificationsTopic.topicArn,
          adUsed: String(buildConfig.Parameters.IsAdUsed),
          domainName: buildConfig.Parameters.DomainName,
          SSOAPIRoleArn: linkprocessProps.listInstancesSSOAPIRoleArn,
          ISAPIRoleArn: linkprocessProps.listGroupsIdentityStoreAPIRoleArn,
          processTargetAccountSMTopicArn:
            linkprocessProps.processTargetAccountSMTopic.topicArn,
          orgListSMRoleArn: linkprocessProps.orgListSMRoleArn,
          processTargetAccountSMArn: `arn:aws:states:us-east-1:${buildConfig.PipelineSettings.OrgMainAccountId}:stateMachine:${buildConfig.Environment}-processTargetAccountSM`,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        },
      }
    );

    this.linkTopicProcessor.addEventSource(
      new SnsEventSource(linkprocessProps.linkProcessorTopic)
    );
  }
}

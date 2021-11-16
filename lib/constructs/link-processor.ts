/*
composite construct that sets up all resources
for links life cycle provisionings
*/

import { Table } from "@aws-cdk/aws-dynamodb";
import { Key } from "@aws-cdk/aws-kms";
import { LayerVersion, Runtime, StartingPosition } from "@aws-cdk/aws-lambda";
import {
  DynamoEventSource,
  SnsDlq,
  SnsEventSource,
} from "@aws-cdk/aws-lambda-event-sources";
import { NodejsFunction } from "@aws-cdk/aws-lambda-nodejs";
import { ITopic, Topic } from "@aws-cdk/aws-sns";
import { Construct } from "@aws-cdk/core";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface LinkProcessProps {
  readonly linksTable: Table;
  readonly provisionedLinksTableName: string;
  readonly groupsTableName: string;
  readonly permissionSetArnTableName: string;
  readonly errorNotificationsTopic: ITopic;
  readonly waiterHandlerNotificationsTopicArn: string;
  readonly linkManagerHandlerSSOAPIRoleArn: string;
  readonly listInstancesSSOAPIRoleArn: string;
  readonly listGroupsIdentityStoreAPIRoleArn: string;
  readonly processTargetAccountSMInvokeRoleArn: string;
  readonly processTargetAccountSMTopic: ITopic;
  readonly nodeJsLayer: LayerVersion;
  readonly snsTopicsKey: Key;
}

export class LinkProcessor extends Construct {
  public readonly linkManagerTopic: Topic;
  public readonly linkManagerHandler: NodejsFunction;
  public readonly linkStreamHandler: NodejsFunction;
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
          "sso-handlers",
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
          ],
          minify: true,
        },
        layers: [linkprocessProps.nodeJsLayer],
        environment: {
          provisionedLinksTable: linkprocessProps.provisionedLinksTableName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          errorNotificationsTopicArn:
            linkprocessProps.errorNotificationsTopic.topicArn,
          waiterTopicArn: linkprocessProps.waiterHandlerNotificationsTopicArn,
          payerAccount: buildConfig.PipelineSettings.OrgMainAccountId,
          SSOAPIRoleArn: linkprocessProps.linkManagerHandlerSSOAPIRoleArn,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        },
      }
    );

    this.linkManagerTopic = new Topic(
      this,
      name(buildConfig, "linkManagerTopic"),
      {
        displayName: name(buildConfig, "linkManagerTopic"),
        masterKey: linkprocessProps.snsTopicsKey,
      }
    );

    this.linkManagerHandler.addEventSource(
      new SnsEventSource(this.linkManagerTopic)
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
          "sso-handlers",
          "src",
          "processTargetAccountSMListener.ts"
        ),
        bundling: {
          externalModules: ["@aws-sdk/client-sns"],
          minify: true,
        },
        layers: [linkprocessProps.nodeJsLayer],
        environment: {
          linkManagertopicArn: this.linkManagerTopic.topicArn,
          errorNotificationsTopicArn:
            linkprocessProps.errorNotificationsTopic.topicArn,
        },
      }
    );

    this.processTargetAccountSMListenerHandler.addEventSource(
      new SnsEventSource(linkprocessProps.processTargetAccountSMTopic)
    );

    this.linkStreamHandler = new NodejsFunction(
      this,
      name(buildConfig, "linkStreamHandler"),
      {
        functionName: name(buildConfig, "linkStreamHandler"),
        runtime: Runtime.NODEJS_14_X,
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "ddb-stream-handlers",
          "src",
          "link.ts"
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
          ],
          minify: true,
        },
        layers: [linkprocessProps.nodeJsLayer],
        environment: {
          topicArn: this.linkManagerTopic.topicArn,
          groupsTable: linkprocessProps.groupsTableName,
          permissionSetArnTable: linkprocessProps.permissionSetArnTableName,
          errorNotificationsTopicArn:
            linkprocessProps.errorNotificationsTopic.topicArn,
          adUsed: String(buildConfig.Parameters.IsAdUsed),
          domainName: buildConfig.Parameters.DomainName,
          SSOAPIRoleArn: linkprocessProps.listInstancesSSOAPIRoleArn,
          ISAPIRoleArn: linkprocessProps.listGroupsIdentityStoreAPIRoleArn,
          processTargetAccountSMTopicArn:
            linkprocessProps.processTargetAccountSMTopic.topicArn,
          processTargetAccountSMInvokeRoleArn:
            linkprocessProps.processTargetAccountSMInvokeRoleArn,
          processTargetAccountSMArn: `arn:aws:states:us-east-1:${buildConfig.PipelineSettings.OrgMainAccountId}:stateMachine:${buildConfig.Environment}-processTargetAccountSM`,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        },
      }
    );

    this.linkStreamHandler.addEventSource(
      new DynamoEventSource(linkprocessProps.linksTable, {
        startingPosition: StartingPosition.TRIM_HORIZON,
        batchSize: 5,
        bisectBatchOnError: true,
        onFailure: new SnsDlq(linkprocessProps.errorNotificationsTopic),
        retryAttempts: 3,
      })
    );
  }
}

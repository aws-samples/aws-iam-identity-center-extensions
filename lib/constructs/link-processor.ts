/*
composite construct that sets up all resources
for links life cycle provisionings
*/

import { Table } from "@aws-cdk/aws-dynamodb";
import { Key } from "@aws-cdk/aws-kms";
import * as lambda from "@aws-cdk/aws-lambda"; //Needed to avoid semgrep throwing up https://cwe.mitre.org/data/definitions/95.html
import {
  DynamoEventSource,
  SnsDlq,
  SnsEventSource,
} from "@aws-cdk/aws-lambda-event-sources";
import { ITopic, Topic } from "@aws-cdk/aws-sns";
import { Construct } from "@aws-cdk/core";
import * as Path from "path";
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
  readonly nodeJsLayer: lambda.LayerVersion;
  readonly snsTopicsKey: Key;
}

export class LinkProcessor extends Construct {
  public readonly linkManagerTopic: Topic;
  public readonly linkManagerHandler: lambda.Function;
  public readonly linkStreamHandler: lambda.Function;
  public readonly processTargetAccountSMListenerHandler: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    linkprocessProps: LinkProcessProps
  ) {
    super(scope, id);

    this.linkManagerHandler = new lambda.Function(
      this,
      name(buildConfig, "linkManagerHandler"),
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: "linkManager.handler",
        functionName: name(buildConfig, "linkManagerHandler"),
        code: lambda.Code.fromAsset(
          Path.join(__dirname, "../", "lambda", "functions", "sso-handlers")
        ),
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

    this.processTargetAccountSMListenerHandler = new lambda.Function(
      this,
      name(buildConfig, "processTargetAccountSMListenerHandler"),
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: "processTargetAccountSMListener.handler",
        functionName: name(
          buildConfig,
          "processTargetAccountSMListenerHandler"
        ),
        code: lambda.Code.fromAsset(
          Path.join(__dirname, "../", "lambda", "functions", "sso-handlers")
        ),
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

    this.linkStreamHandler = new lambda.Function(
      this,
      name(buildConfig, "linkStreamHandler"),
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: "link.handler",
        functionName: name(buildConfig, "linkStreamHandler"),
        code: lambda.Code.fromAsset(
          Path.join(
            __dirname,
            "../",
            "lambda",
            "functions",
            "ddb-stream-handlers"
          )
        ),
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
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 5,
        bisectBatchOnError: true,
        onFailure: new SnsDlq(linkprocessProps.errorNotificationsTopic),
        retryAttempts: 3,
      })
    );
  }
}

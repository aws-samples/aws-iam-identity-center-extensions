/*
composite construct that sets up all resources
for permission set life cycle provisioning
*/

import { Table } from "@aws-cdk/aws-dynamodb";
import { Key } from "@aws-cdk/aws-kms";
import * as lambda from "@aws-cdk/aws-lambda"; //Needed to avoid semgrep throwing up https://cwe.mitre.org/data/definitions/95.html
import {
  DynamoEventSource,
  SnsDlq,
  SnsEventSource,
} from "@aws-cdk/aws-lambda-event-sources";
import { NodejsFunction } from "@aws-cdk/aws-lambda-nodejs";
import { ITopic, Topic } from "@aws-cdk/aws-sns";
import { Construct } from "@aws-cdk/core";
import * as Path from "path";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface PermissionSetProcessProps {
  readonly nodeJsLayer: lambda.LayerVersion;
  readonly permissionSetTable: Table;
  readonly PermissionSetArnTableName: string;
  readonly errorNotificationsTopic: ITopic;
  readonly waiterHandlerNotificationsTopicArn: string;
  readonly permissionSetHandlerSSOAPIRoleArn: string;
  readonly linksTableName: string;
  readonly groupsTableName: string;
  readonly linkManagerTopicArn: string;
  readonly listInstancesSSOAPIRoleArn: string;
  readonly listGroupsIdentityStoreAPIRoleArn: string;
  readonly processTargetAccountSMInvokeRoleArn: string;
  readonly processTargetAccountSMTopic: ITopic;
  readonly snsTopicsKey: Key;
}

export class PermissionSetProcessor extends Construct {
  public readonly permissionSetHandler: lambda.Function;
  public readonly permissionSetStreamHandler: lambda.Function;
  public readonly permissionSetTopic: Topic;
  public readonly permissionSetSyncTopic: Topic;
  public readonly permissionSetSyncHandler: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    permissionSetProcessorProps: PermissionSetProcessProps
  ) {
    super(scope, id);

    this.permissionSetTopic = new Topic(
      this,
      name(buildConfig, "permissionSetTopic"),
      {
        displayName: name(buildConfig, "permissionSetTopic"),
        masterKey: permissionSetProcessorProps.snsTopicsKey,
      }
    );

    this.permissionSetSyncTopic = new Topic(
      this,
      name(buildConfig, "permissionSetSyncTopic"),
      {
        displayName: name(buildConfig, "permissionSetSyncTopic"),
        masterKey: permissionSetProcessorProps.snsTopicsKey,
      }
    );

    this.permissionSetStreamHandler = new NodejsFunction(
      this,
      name(buildConfig, "permissionSetStreamHandler"),
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        functionName: name(buildConfig, "permissionSetStreamHandler"),
        entry: Path.join(
          __dirname,
          "../",
          "lambda-functions",
          "ddb-import-handlers",
          "src",
          "permissionSetApi.ts"
        ),
        bundling: {
          minify: true,
          externalModules: ["@aws-sdk/client-sns", "dynamo-stream-diff"],
        },
        layers: [permissionSetProcessorProps.nodeJsLayer],
        environment: {
          topicArn: this.permissionSetTopic.topicArn,
          errorNotificationsTopicArn:
            permissionSetProcessorProps.errorNotificationsTopic.topicArn,
        },
      }
    );

    this.permissionSetStreamHandler.addEventSource(
      new DynamoEventSource(permissionSetProcessorProps.permissionSetTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 5,
        bisectBatchOnError: true,
        onFailure: new SnsDlq(
          permissionSetProcessorProps.errorNotificationsTopic
        ),
        retryAttempts: 3,
      })
    );

    this.permissionSetHandler = new lambda.Function(
      this,
      name(buildConfig, "permissionSetHandler"),
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: "permissionSetTopic.handler",
        functionName: name(buildConfig, "permissionSetHandler"),
        code: lambda.Code.fromAsset(
          Path.join(__dirname, "../", "lambda-functions", "sso-handlers", "src")
        ),
        layers: [permissionSetProcessorProps.nodeJsLayer],
        environment: {
          DdbTable: permissionSetProcessorProps.permissionSetTable.tableName,
          Arntable: permissionSetProcessorProps.PermissionSetArnTableName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          errorNotificationsTopicArn:
            permissionSetProcessorProps.errorNotificationsTopic.topicArn,
          waiterTopicArn:
            permissionSetProcessorProps.waiterHandlerNotificationsTopicArn,
          permissionSetSyncTopicArn: this.permissionSetSyncTopic.topicArn,
          SSOAPIRoleArn:
            permissionSetProcessorProps.permissionSetHandlerSSOAPIRoleArn,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        },
      }
    );

    this.permissionSetHandler.addEventSource(
      new SnsEventSource(this.permissionSetTopic)
    );

    this.permissionSetSyncHandler = new lambda.Function(
      this,
      name(buildConfig, "permissionSetSyncHandler"),
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: "permissionSetSync.handler",
        functionName: name(buildConfig, "permissionSetSyncHandler"),
        code: lambda.Code.fromAsset(
          Path.join(__dirname, "../", "lambda-functions", "sso-handlers", "src")
        ),
        layers: [permissionSetProcessorProps.nodeJsLayer],
        environment: {
          linksTableName: permissionSetProcessorProps.linksTableName,
          groupsTableName: permissionSetProcessorProps.groupsTableName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          errorNotificationsTopicArn:
            permissionSetProcessorProps.errorNotificationsTopic.topicArn,
          linkManagerTopicArn: permissionSetProcessorProps.linkManagerTopicArn,
          SSOAPIRoleArn: permissionSetProcessorProps.listInstancesSSOAPIRoleArn,
          ISAPIRoleArn:
            permissionSetProcessorProps.listGroupsIdentityStoreAPIRoleArn,
          adUsed: String(buildConfig.Parameters.IsAdUsed),
          domainName: buildConfig.Parameters.DomainName,
          processTargetAccountSMTopicArn:
            permissionSetProcessorProps.processTargetAccountSMTopic.topicArn,
          processTargetAccountSMInvokeRoleArn:
            permissionSetProcessorProps.processTargetAccountSMInvokeRoleArn,
          processTargetAccountSMArn: `arn:aws:states:us-east-1:${buildConfig.PipelineSettings.OrgMainAccountId}:stateMachine:${buildConfig.Environment}-processTargetAccountSM`,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        },
      }
    );

    this.permissionSetSyncHandler.addEventSource(
      new SnsEventSource(this.permissionSetSyncTopic)
    );
  }
}

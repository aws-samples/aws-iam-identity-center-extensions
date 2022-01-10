/*
composite construct that sets up all resources
for permission set life cycle provisioning
*/

import { Duration } from "aws-cdk-lib";
import { ITable } from "aws-cdk-lib/aws-dynamodb"; // Importing external resources in CDK would use interfaces and not base objects
import { IKey } from "aws-cdk-lib/aws-kms"; // Importing external resources in CDK would use interfaces and not base objects
import * as lambda from "aws-cdk-lib/aws-lambda"; //Needed to avoid semgrep throwing up https://cwe.mitre.org/data/definitions/95.html
import { SnsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface PermissionSetProcessProps {
  readonly nodeJsLayer: lambda.ILayerVersion;
  readonly permissionSetTable: ITable;
  readonly PermissionSetArnTableName: string;
  readonly errorNotificationsTopic: ITopic;
  readonly permissionSetHandlerSSOAPIRoleArn: string;
  readonly linksTableName: string;
  readonly linkQueueUrl: string;
  readonly listInstancesSSOAPIRoleArn: string;
  readonly listGroupsIdentityStoreAPIRoleArn: string;
  readonly orgListSMRoleArn: string;
  readonly waiterHandlerSSOAPIRoleArn: string;
  readonly processTargetAccountSMTopic: ITopic;
  readonly permissionSetProcessorTopic: ITopic;
  readonly snsTopicsKey: IKey;
}

export class PermissionSetProcessor extends Construct {
  public readonly permissionSetTopicProcessor: NodejsFunction;
  public readonly permissionSetSyncTopic: Topic;
  public readonly permissionSetSyncHandler: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    permissionSetProcessorProps: PermissionSetProcessProps
  ) {
    super(scope, id);

    this.permissionSetSyncTopic = new Topic(
      this,
      name(buildConfig, "permissionSetSyncTopic"),
      {
        displayName: name(buildConfig, "permissionSetSyncTopic"),
        masterKey: permissionSetProcessorProps.snsTopicsKey,
      }
    );

    this.permissionSetTopicProcessor = new NodejsFunction(
      this,
      name(buildConfig, "permissionSetTopicProcessor"),
      {
        functionName: name(buildConfig, "permissionSetTopicProcessor"),
        runtime: lambda.Runtime.NODEJS_14_X,
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "application-handlers",
          "src",
          "permissionSetTopicProcessor.ts"
        ),
        bundling: {
          externalModules: [
            "@aws-sdk/client-sns",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/client-sso-admin",
            "@aws-sdk/credential-providers",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/util-waiter",
            "json-diff",
            "uuid",
          ],
          minify: true,
        },
        layers: [permissionSetProcessorProps.nodeJsLayer],
        environment: {
          DdbTable: permissionSetProcessorProps.permissionSetTable.tableName,
          Arntable: permissionSetProcessorProps.PermissionSetArnTableName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          errorNotificationsTopicArn:
            permissionSetProcessorProps.errorNotificationsTopic.topicArn,
          permissionSetSyncTopicArn: this.permissionSetSyncTopic.topicArn,
          SSOAPIRoleArn:
            permissionSetProcessorProps.permissionSetHandlerSSOAPIRoleArn,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          waiterHandlerSSOAPIRoleArn:
            permissionSetProcessorProps.waiterHandlerSSOAPIRoleArn,
        },
        timeout: Duration.minutes(11), //aggressive timeout to accommodate SSO Admin API's workflow based logic
      }
    );

    this.permissionSetTopicProcessor.addEventSource(
      new SnsEventSource(
        permissionSetProcessorProps.permissionSetProcessorTopic
      )
    );

    this.permissionSetSyncHandler = new NodejsFunction(
      this,
      name(buildConfig, "permissionSetSyncHandler"),
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        functionName: name(buildConfig, "permissionSetSyncHandler"),
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "application-handlers",
          "src",
          "permissionSetSync.ts"
        ),
        bundling: {
          externalModules: [
            "@aws-sdk/client-sns",
            "@aws-sdk/client-sfn",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/client-identitystore",
            "@aws-sdk/client-sso-admin",
            "@aws-sdk/credential-providers",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-sqs",
            "uuid",
          ],
          minify: true,
        },
        layers: [permissionSetProcessorProps.nodeJsLayer],
        environment: {
          linksTableName: permissionSetProcessorProps.linksTableName,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          errorNotificationsTopicArn:
            permissionSetProcessorProps.errorNotificationsTopic.topicArn,
          linkQueueUrl: permissionSetProcessorProps.linkQueueUrl,
          SSOAPIRoleArn: permissionSetProcessorProps.listInstancesSSOAPIRoleArn,
          ISAPIRoleArn:
            permissionSetProcessorProps.listGroupsIdentityStoreAPIRoleArn,
          adUsed: String(buildConfig.Parameters.IsAdUsed),
          domainName: buildConfig.Parameters.DomainName,
          processTargetAccountSMTopicArn:
            permissionSetProcessorProps.processTargetAccountSMTopic.topicArn,
          orgListSMRoleArn: permissionSetProcessorProps.orgListSMRoleArn,
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

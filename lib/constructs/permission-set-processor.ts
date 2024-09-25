/**
 * Composite construct that sets up all resources for permission set life cycle
 * provisioning
 */

import { Duration } from "aws-cdk-lib";
import { ITable } from "aws-cdk-lib/aws-dynamodb";
import { IKey } from "aws-cdk-lib/aws-kms";
import { Architecture, ILayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import {
  SnsEventSource,
  SqsEventSource,
} from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ITopic, Topic } from "aws-cdk-lib/aws-sns";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";
import { name } from "./helpers";
export interface PermissionSetProcessProps {
  readonly nodeJsLayer: ILayerVersion;
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
  readonly sqsKey: IKey;
  readonly ssoMPRoleArn: string;
  readonly managedPolicyOpArn: string;
  readonly customerManagedPolicyOpArn: string;
  readonly iteratorArn: string;
}

export class PermissionSetProcessor extends Construct {
  public readonly permissionSetTopicProcessor: NodejsFunction;
  public readonly permissionSetSyncTopic: Topic;
  public readonly permissionSetSyncHandler: NodejsFunction;
  public readonly managedPolicyQueue: Queue;
  public readonly managedPolicyDLQ: Queue;
  public readonly managedPolicyQueueProcessor: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    permissionSetProcessorProps: PermissionSetProcessProps,
  ) {
    super(scope, id);

    this.permissionSetSyncTopic = new Topic(
      this,
      name(buildConfig, "permissionSetSyncTopic"),
      {
        displayName: name(buildConfig, "permissionSetSyncTopic"),
        masterKey: permissionSetProcessorProps.snsTopicsKey,
      },
    );

    this.managedPolicyDLQ = new Queue(
      this,
      name(buildConfig, "managedPolicyDLQ"),
      {
        fifo: true,
        encryption: QueueEncryption.KMS,
        encryptionMasterKey: permissionSetProcessorProps.sqsKey,
        visibilityTimeout: Duration.hours(1),
        queueName: name(buildConfig, "managedPolicyDLQ.fifo"),
      },
    );

    this.managedPolicyQueue = new Queue(
      this,
      name(buildConfig, "managedPolicyQueue"),
      {
        fifo: true,
        encryption: QueueEncryption.KMS,
        encryptionMasterKey: permissionSetProcessorProps.sqsKey,
        visibilityTimeout: Duration.hours(2),
        contentBasedDeduplication: true,
        queueName: name(buildConfig, "managedPolicyQueue.fifo"),
        deadLetterQueue: {
          queue: this.managedPolicyDLQ,
          maxReceiveCount: 2,
        },
        retentionPeriod: Duration.days(1),
      },
    );

    this.permissionSetTopicProcessor = new NodejsFunction(
      this,
      name(buildConfig, "permissionSetTopicProcessor"),
      {
        functionName: name(buildConfig, "permissionSetTopicProcessor"),
        runtime: Runtime.NODEJS_20_X,
        architecture: Architecture.ARM_64,
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "application-handlers",
          "src",
          "permissionSetTopicProcessor.ts",
        ),
        bundling: {
          externalModules: [
            "@aws-sdk/client-sns",
            "@aws-sdk/client-sqs",
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
          managedPolicyQueueUrl: this.managedPolicyQueue.queueUrl,
          iteratorArn: permissionSetProcessorProps.iteratorArn,
          customerManagedPolicyOpArn:
            permissionSetProcessorProps.customerManagedPolicyOpArn,
          managedPolicyOpArn: permissionSetProcessorProps.managedPolicyOpArn,
          customerManagedPolicySM: `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-customerManagedPolicySM`,
          managedPolicySM: `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-managedPolicySM`,
          functionLogMode: buildConfig.Parameters.FunctionLogMode,
        },
        timeout: Duration.minutes(11), //aggressive timeout to accommodate SSO Admin API's workflow based logic
      },
    );

    this.permissionSetTopicProcessor.addEventSource(
      new SnsEventSource(
        permissionSetProcessorProps.permissionSetProcessorTopic,
      ),
    );

    this.permissionSetSyncHandler = new NodejsFunction(
      this,
      name(buildConfig, "permissionSetSyncHandler"),
      {
        runtime: Runtime.NODEJS_20_X,
        architecture: Architecture.ARM_64,
        functionName: name(buildConfig, "permissionSetSyncHandler"),
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "application-handlers",
          "src",
          "permissionSetSync.ts",
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
          supportNestedOU: String(buildConfig.Parameters.SupportNestedOU),
          functionLogMode: buildConfig.Parameters.FunctionLogMode,
        },
      },
    );

    this.permissionSetSyncHandler.addEventSource(
      new SnsEventSource(this.permissionSetSyncTopic),
    );

    this.managedPolicyQueueProcessor = new NodejsFunction(
      this,
      name(buildConfig, "managedPolicyQueueProcessor"),
      {
        runtime: Runtime.NODEJS_20_X,
        architecture: Architecture.ARM_64,
        functionName: name(buildConfig, "managedPolicyQueueProcessor"),
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "application-handlers",
          "src",
          "managedPolicyQueueProcessor.ts",
        ),
        bundling: {
          externalModules: [
            "@aws-sdk/client-sns",
            "@aws-sdk/client-sfn",
            "@aws-sdk/credential-providers",
            "uuid",
          ],
          minify: true,
        },
        layers: [permissionSetProcessorProps.nodeJsLayer],
        environment: {
          SSOMPRoleArn: permissionSetProcessorProps.ssoMPRoleArn,
          AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
          errorNotificationsTopicArn:
            permissionSetProcessorProps.errorNotificationsTopic.topicArn,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          functionLogMode: buildConfig.Parameters.FunctionLogMode,
        },
      },
    );

    this.managedPolicyQueueProcessor.addEventSource(
      new SqsEventSource(this.managedPolicyQueue, {
        batchSize: 5,
        reportBatchItemFailures: true,
      }),
    );
  }
}

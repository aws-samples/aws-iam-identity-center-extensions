/*
Utility construct in solution artefacts stack
that allows shareable resources and has no dependencies
on other constructs
*/

import { Duration } from "aws-cdk-lib";
import { Key } from "aws-cdk-lib/aws-kms";
import {
  BlockPublicAccess,
  Bucket,
  BucketEncryption,
} from "aws-cdk-lib/aws-s3";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";
import { SSMParamReader } from "./ssm-param-reader";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class IndependentUtility extends Construct {
  public readonly errorNotificationsTopic: Topic;
  public readonly ssoArtefactsBucket: Bucket;
  public readonly linkManagerQueue: Queue;
  public readonly linkManagerDLQ: Queue;
  public readonly waiterHandlerSSOAPIRoleArn: string;
  public readonly ddbTablesKey: Key;
  public readonly s3ArtefactsKey: Key;
  public readonly snsTopicsKey: Key;
  public readonly logsKey: Key;
  public readonly queuesKey: Key;

  constructor(scope: Construct, id: string, buildConfig: BuildConfig) {
    super(scope, id);

    this.logsKey = new Key(this, name(buildConfig, "logsKey"), {
      enableKeyRotation: true,
      alias: name(buildConfig, "logsKey"),
      description:
        "KMS CMK used for encrypting/decrypting all logs used in aws-sso-extensions-for-enterprise solution target account",
    });

    this.s3ArtefactsKey = new Key(this, name(buildConfig, "s3ArtefactsKey"), {
      enableKeyRotation: true,
      alias: name(buildConfig, "s3ArtefactsKey"),
      description:
        "KMS CMK used for encrypting/decrypting all s3 artefacts used in aws-sso-extensions-for-enterprise solution provisioning/de-provisioning",
    });

    this.snsTopicsKey = new Key(this, name(buildConfig, "snsTopicsKey"), {
      enableKeyRotation: true,
      alias: name(buildConfig, "snsTopicsKey"),
      description:
        "KMS CMK used for encrypting/decrypting all SNS topic payloads used in aws-sso-extensions-for-enterprise solution target account",
    });

    this.ddbTablesKey = new Key(this, name(buildConfig, "ddbTablesKey"), {
      enableKeyRotation: true,
      alias: name(buildConfig, "ddbTablesKey"),
      description:
        "KMS CMK used for encrypting/decrypting all DynamoDB tables used in aws-sso-extensions-for-enterprise solution",
    });

    this.queuesKey = new Key(this, name(buildConfig, "queuesKey"), {
      enableKeyRotation: true,
      alias: name(buildConfig, "queuesKey"),
      description:
        "KMS CMK used for encrypting/decrypting all SQS queues used in aws-sso-extensions-for-enterprise solution",
    });

    this.errorNotificationsTopic = new Topic(
      this,
      name(buildConfig, "errorNotificationsTopic"),
      {
        displayName: name(buildConfig, "errorNotificationsTopic"),
        masterKey: this.snsTopicsKey,
      }
    );

    const logsBucket = new Bucket(
      this,
      name(buildConfig, "accessLoggingBucket"),
      {
        encryption: BucketEncryption.KMS,
        encryptionKey: this.logsKey,
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
      }
    );

    this.ssoArtefactsBucket = new Bucket(
      this,
      name(buildConfig, "ssoArtefactsBucket"),
      {
        encryption: BucketEncryption.KMS,
        versioned: false,
        blockPublicAccess: BlockPublicAccess.BLOCK_ALL,
        encryptionKey: this.s3ArtefactsKey,
        serverAccessLogsBucket: logsBucket,
        serverAccessLogsPrefix: name(
          buildConfig,
          "aws-sso-extensions-for-enterprise"
        ),
      }
    );

    this.errorNotificationsTopic.addSubscription(
      new EmailSubscription(buildConfig.Parameters.NotificationEmail)
    );

    this.waiterHandlerSSOAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "waiterHandlerSSOAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "waiterHandler-ssoapi-roleArn",
      }
    ).paramValue;

    this.linkManagerDLQ = new Queue(this, name(buildConfig, "linkManagerDLQ"), {
      fifo: true,
      encryption: QueueEncryption.KMS,
      encryptionMasterKey: this.queuesKey,
      visibilityTimeout: Duration.hours(
        buildConfig.Parameters.accountAssignmentVisibilityDLQTimeOutHours
      ),
      queueName: name(buildConfig, "linkManagerDLQ.fifo"),
    });

    this.linkManagerQueue = new Queue(
      this,
      name(buildConfig, "linkManagerQueue"),
      {
        fifo: true,
        encryption: QueueEncryption.KMS,
        encryptionMasterKey: this.queuesKey,
        visibilityTimeout: Duration.hours(
          buildConfig.Parameters.accountAssignmentVisibilityTimeOutHours
        ),
        contentBasedDeduplication: true,
        queueName: name(buildConfig, "linkManagerQueue.fifo"),
        deadLetterQueue: {
          queue: this.linkManagerDLQ,
          maxReceiveCount: 2,
        },
      }
    );

    new StringParameter(this, name(buildConfig, "errorNotificationsTopicArn"), {
      parameterName: name(buildConfig, "errorNotificationsTopicArn"),
      stringValue: this.errorNotificationsTopic.topicArn,
    });

    new StringParameter(this, name(buildConfig, "snsTopicsKeyArn"), {
      parameterName: name(buildConfig, "snsTopicsKeyArn"),
      stringValue: this.snsTopicsKey.keyArn,
    });

    new StringParameter(this, name(buildConfig, "ddbTablesKeyArn"), {
      parameterName: name(buildConfig, "ddbTablesKeyArn"),
      stringValue: this.ddbTablesKey.keyArn,
    });

    new StringParameter(this, name(buildConfig, "waiterHandlerSSOAPIRoleArn"), {
      parameterName: name(buildConfig, "waiterHandlerSSOAPIRoleArn"),
      stringValue: this.waiterHandlerSSOAPIRoleArn,
    });

    new StringParameter(this, name(buildConfig, "queuesKeyArn"), {
      parameterName: name(buildConfig, "queuesKeyArn"),
      stringValue: this.queuesKey.keyArn,
    });

    new StringParameter(this, name(buildConfig, "linkQueueArn"), {
      parameterName: name(buildConfig, "linkQueueArn"),
      stringValue: this.linkManagerQueue.queueArn,
    });

    new StringParameter(this, name(buildConfig, "ssoArtefactsBucketName"), {
      parameterName: name(buildConfig, "ssoArtefactsBucketName"),
      stringValue: this.ssoArtefactsBucket.bucketName,
    });

    new StringParameter(this, name(buildConfig, "ssoArtefactsBucketKeyArn"), {
      parameterName: name(buildConfig, "ssoArtefactsBucketKeyArn"),
      stringValue: this.s3ArtefactsKey.keyArn,
    });
  }
}

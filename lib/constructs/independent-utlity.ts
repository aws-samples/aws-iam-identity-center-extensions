/*
Utility construct in solution artefacts stack
that allows shareable resources and has no dependencies
on other constructs
*/

import { Key } from "@aws-cdk/aws-kms";
import * as lambda from "@aws-cdk/aws-lambda"; //Needed to avoid semgrep throwing up https://cwe.mitre.org/data/definitions/95.html
import { BlockPublicAccess, Bucket, BucketEncryption } from "@aws-cdk/aws-s3";
import { Topic } from "@aws-cdk/aws-sns";
import { EmailSubscription } from "@aws-cdk/aws-sns-subscriptions";
import { Construct } from "@aws-cdk/core";
import { BuildConfig } from "../build/buildConfig";
import { SSMParamReader } from "./ssm-param-reader";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface IndependentUtilityProps {
  readonly nodeJsLayer: lambda.LayerVersion;
}

export class IndependentUtility extends Construct {
  public readonly errorNotificationsTopic: Topic;
  public readonly ssoArtefactsBucket: Bucket;
  public readonly waiterHandlerSSOAPIRoleArn: string;
  public readonly permissionSetHandlerSSOAPIRoleArn: string;
  public readonly linkManagerHandlerSSOAPIRoleArn: string;
  public readonly listInstancesSSOAPIRoleArn: string;
  public readonly listGroupsIdentityStoreAPIRoleArn: string;
  public readonly processTargetAccountSMInvokeRoleArn: string;
  public readonly ddbTablesKey: Key;
  public readonly s3ArtefactsKey: Key;
  public readonly snsTopicsKey: Key;
  public readonly logsKey: Key;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    independentUtilityProps: IndependentUtilityProps
  ) {
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
        LambdaLayers: independentUtilityProps.nodeJsLayer,
      }
    ).paramValue;

    this.permissionSetHandlerSSOAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "permissionSetHandlerSSOAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "permissionSetHandler-ssoapi-roleArn",
        LambdaLayers: independentUtilityProps.nodeJsLayer,
      }
    ).paramValue;

    this.linkManagerHandlerSSOAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "linkManagerHandlerSSOAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "linkManagerHandler-ssoapi-roleArn",
        LambdaLayers: independentUtilityProps.nodeJsLayer,
      }
    ).paramValue;

    this.listInstancesSSOAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "listInstancesSSOAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "listInstances-ssoapi-roleArn",
        LambdaLayers: independentUtilityProps.nodeJsLayer,
      }
    ).paramValue;

    this.listGroupsIdentityStoreAPIRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "listGroupsIdentityStoreAPIRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
        ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        ParamNameKey: "listgroups-identitystoreapi-roleArn",
        LambdaLayers: independentUtilityProps.nodeJsLayer,
      }
    ).paramValue;

    this.processTargetAccountSMInvokeRoleArn = new SSMParamReader(
      this,
      name(buildConfig, "processTargetAccountSMInvokeRoleArnpr"),
      buildConfig,
      {
        ParamAccountId: buildConfig.PipelineSettings.OrgMainAccountId,
        ParamRegion: "us-east-1",
        ParamNameKey: "processTargetAccountSMInvoke-orgapi-roleArn",
        LambdaLayers: independentUtilityProps.nodeJsLayer,
      }
    ).paramValue;
  }
}

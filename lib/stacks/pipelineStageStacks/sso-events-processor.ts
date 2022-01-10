/*
Deploys event bridge rules for SSO events in SSO account
*/
import { Rule, RuleTargetInput } from "aws-cdk-lib/aws-events";
import { SnsTopic } from "aws-cdk-lib/aws-events-targets";
import {
  AccountPrincipal,
  PolicyStatement,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Topic } from "aws-cdk-lib/aws-sns";
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BuildConfig } from "../../build/buildConfig";
import { SSMParamWriter } from "../../constructs/ssm-param-writer";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class SSOEventsProcessor extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    const ssoArtefactsKey = new Key(
      this,
      name(buildConfig, "ssoArtefactsKey"),
      {
        enableKeyRotation: true,
        alias: name(buildConfig, "ssoArtefactsKey"),
      }
    );

    ssoArtefactsKey.grantEncryptDecrypt(
      new ServicePrincipal("events.amazonaws.com")
    );

    const ssoGroupEventsNotificationTopic = new Topic(
      this,
      name(buildConfig, "ssoGroupEventsNotificationTopic"),
      {
        masterKey: ssoArtefactsKey,
        displayName: name(buildConfig, "ssoGroupEventsNotificationTopic"),
      }
    );

    ssoGroupEventsNotificationTopic.addToResourcePolicy(
      new PolicyStatement({
        actions: ["SNS:Subscribe", "SNS:Receive"],
        resources: ["*"],
        principals: [
          new AccountPrincipal(buildConfig.PipelineSettings.TargetAccountId),
        ],
      })
    );

    new SSMParamWriter(
      this,
      name(buildConfig, "ssoGroupEventsNotificationTopicArn"),
      buildConfig,
      {
        ParamNameKey: "ssoGroupEventsNotificationTopicArn",
        ParamValue: ssoGroupEventsNotificationTopic.topicArn,
        ReaderAccountId: buildConfig.PipelineSettings.TargetAccountId,
      }
    );

    const ssoGroupHandlerTrigger = new Rule(
      this,
      name(buildConfig, "ssoGroupHandlerTrigger"),
      {
        description: "Process SCIM group changes",
        enabled: true,
        eventPattern: {
          account: [this.account],
          detail: {
            eventSource: ["sso-directory.amazonaws.com"],
            eventName: ["CreateGroup", "DeleteGroup"],
          },
        },
        ruleName: name(buildConfig, "ssoGroupHandler"),
      }
    );

    ssoGroupHandlerTrigger.addTarget(
      new SnsTopic(ssoGroupEventsNotificationTopic, {
        message: RuleTargetInput,
      })
    );

    const ssoUserEventsNotificationTopic = new Topic(
      this,
      name(buildConfig, "ssoUserEventsNotificationTopic"),
      {
        masterKey: ssoArtefactsKey,
        displayName: name(buildConfig, "ssoUserEventsNotificationTopic"),
      }
    );

    ssoUserEventsNotificationTopic.addToResourcePolicy(
      new PolicyStatement({
        actions: ["SNS:Subscribe", "SNS:Receive"],
        resources: ["*"],
        principals: [
          new AccountPrincipal(buildConfig.PipelineSettings.TargetAccountId),
        ],
      })
    );

    new SSMParamWriter(
      this,
      name(buildConfig, "ssoUserEventsNotificationTopicArn"),
      buildConfig,
      {
        ParamNameKey: "ssoUserEventsNotificationTopicArn",
        ParamValue: ssoUserEventsNotificationTopic.topicArn,
        ReaderAccountId: buildConfig.PipelineSettings.TargetAccountId,
      }
    );

    const ssoUserHandlerTrigger = new Rule(
      this,
      name(buildConfig, "ssoUserHandlerTrigger"),
      {
        description: "Process SCIM User changes",
        enabled: true,
        eventPattern: {
          account: [this.account],
          detail: {
            eventSource: ["sso-directory.amazonaws.com"],
            eventName: ["CreateUser", "DeleteUser"],
          },
        },
        ruleName: name(buildConfig, "ssoUserHandler"),
      }
    );

    ssoUserHandlerTrigger.addTarget(
      new SnsTopic(ssoUserEventsNotificationTopic, {
        message: RuleTargetInput,
      })
    );
  }
}

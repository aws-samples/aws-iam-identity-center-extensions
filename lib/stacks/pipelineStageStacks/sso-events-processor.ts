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

    const ssoEventsNotificationTopic = new Topic(
      this,
      name(buildConfig, "ssoEventsNotificationTopic"),
      {
        masterKey: ssoArtefactsKey,
        displayName: name(buildConfig, "ssoEventsNotificationTopic"),
      }
    );

    ssoEventsNotificationTopic.addToResourcePolicy(
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
      name(buildConfig, "ssoEventsNotificationTopicArn"),
      buildConfig,
      {
        ParamNameKey: "ssoEventsNotificationTopicArn",
        ParamValue: ssoEventsNotificationTopic.topicArn,
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

    ssoArtefactsKey.grantEncryptDecrypt(
      new ServicePrincipal("events.amazonaws.com")
    );

    ssoGroupHandlerTrigger.addTarget(
      new SnsTopic(ssoEventsNotificationTopic, {
        message: RuleTargetInput,
      })
    );
  }
}

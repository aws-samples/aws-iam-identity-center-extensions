/*
Deploys even bridge rules for org events in Org Main account
*/
import { Rule, RuleTargetInput } from "aws-cdk-lib/aws-events";
import { SnsTopic } from "aws-cdk-lib/aws-events-targets";
import {
  AccountPrincipal,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Topic } from "aws-cdk-lib/aws-sns";
import { CfnStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BuildConfig } from "../../build/buildConfig";
import { CrossAccountRole } from "../../constructs/cross-account-role";
import { SSMParamWriter } from "../../constructs/ssm-param-writer";
import * as processTargetAccountSMJSON from "../../state-machines/processTargetAccounts-asl.json";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class OrgEventsProcessor extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    const orgArtefactsKey = new Key(
      this,
      name(buildConfig, "orgArtefactsKey"),
      {
        enableKeyRotation: true,
        alias: name(buildConfig, "orgArtefactsKey"),
      }
    );

    orgArtefactsKey.grantEncryptDecrypt(
      new ServicePrincipal("events.amazonaws.com")
    );

    const orgEventsnotificationsTopic = new Topic(
      this,
      name(buildConfig, "orgEventsnotificationsTopic"),
      {
        masterKey: orgArtefactsKey,
        displayName: name(buildConfig, "orgEventsnotificationsTopic"),
      }
    );

    orgEventsnotificationsTopic.addToResourcePolicy(
      new PolicyStatement({
        principals: [
          new AccountPrincipal(buildConfig.PipelineSettings.TargetAccountId),
        ],
        actions: ["SNS:Subscribe", "SNS:Receive"],
        resources: [orgEventsnotificationsTopic.topicArn],
      })
    );

    new SSMParamWriter(
      this,
      name(buildConfig, "orgEventsNotificationsTopicArn"),
      buildConfig,
      {
        ParamNameKey: "orgEventsNotificationsTopicArn",
        ParamValue: orgEventsnotificationsTopic.topicArn,
        ReaderAccountId: buildConfig.PipelineSettings.TargetAccountId,
      }
    );

    const processTargetAccountSMTopic = new Topic(
      this,
      name(buildConfig, "processTargetAccountSMTopic"),
      {
        masterKey: orgArtefactsKey,
        displayName: name(buildConfig, "processTargetAccountSMTopic"),
      }
    );

    processTargetAccountSMTopic.addToResourcePolicy(
      new PolicyStatement({
        principals: [
          new AccountPrincipal(buildConfig.PipelineSettings.TargetAccountId),
        ],
        actions: ["SNS:Subscribe", "SNS:Receive"],
        resources: [processTargetAccountSMTopic.topicArn],
      })
    );

    new SSMParamWriter(
      this,
      name(buildConfig, "processTargetAccountSMTopicArn"),
      buildConfig,
      {
        ParamNameKey: "processTargetAccountSMTopicArn",
        ParamValue: processTargetAccountSMTopic.topicArn,
        ReaderAccountId: buildConfig.PipelineSettings.TargetAccountId,
      }
    );

    const createAccountTrigger = new Rule(
      this,
      name(buildConfig, "createAccountTrigger"),
      {
        description: "Process Create Account Events",
        enabled: true,
        eventPattern: {
          account: [buildConfig.PipelineSettings.OrgMainAccountId],
          detail: {
            eventSource: ["organizations.amazonaws.com"],
            eventName: ["CreateAccountResult"],
            serviceEventDetails: {
              createAccountStatus: {
                state: ["SUCCEEDED"],
              },
            },
          },
        },
        ruleName: name(buildConfig, "createAccountTrigger"),
      }
    );
    createAccountTrigger.addTarget(
      new SnsTopic(orgEventsnotificationsTopic, {
        message: RuleTargetInput,
      })
    );
    const moveAccountTrigger = new Rule(
      this,
      name(buildConfig, "moveAccountTrigger"),
      {
        description: "Process Move Account Events",
        enabled: true,
        eventPattern: {
          account: [buildConfig.PipelineSettings.OrgMainAccountId],
          detail: {
            eventSource: ["organizations.amazonaws.com"],
            eventName: ["MoveAccount"],
            errorCode: [{ exists: false }],
          },
        },
        ruleName: name(buildConfig, "moveAccountTrigger"),
      }
    );
    moveAccountTrigger.addTarget(
      new SnsTopic(orgEventsnotificationsTopic, {
        message: RuleTargetInput,
      })
    );

    const accountTagChangeTrigger = new Rule(
      this,
      name(buildConfig, "accountTagChangeTrigger"),
      {
        description: "Process account tag change Events",
        enabled: true,
        eventPattern: {
          account: [buildConfig.PipelineSettings.OrgMainAccountId],
          source: ["aws.tag"],
          detailType: ["Tag Change on Resource"],
          detail: {
            service: ["organizations"],
            "resource-type": ["account"],
            errorCode: [{ exists: false }],
          },
        },
        ruleName: name(buildConfig, "accountTagChangeTrigger"),
      }
    );
    accountTagChangeTrigger.addTarget(
      new SnsTopic(orgEventsnotificationsTopic, {
        message: RuleTargetInput,
      })
    );

    const processTargetAccountSMRole = new Role(
      this,
      name(buildConfig, "processTargetAccountSMRole"),
      {
        roleName: name(buildConfig, "processTargetAccountSMRole"),
        assumedBy: new ServicePrincipal("states.amazonaws.com"),
      }
    );

    processTargetAccountSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["tag:GetResources", "tag:GetTagValues", "tag:GetTagKeys"],
        resources: ["*"],
      })
    );

    processTargetAccountSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["organizations:Describe*", "organizations:List*"],
        resources: ["*"],
      })
    );

    processTargetAccountSMRole.addToPrincipalPolicy(
      new PolicyStatement({
        actions: ["sns:Publish"],
        resources: [processTargetAccountSMTopic.topicArn],
      })
    );

    orgArtefactsKey.grantEncryptDecrypt(processTargetAccountSMRole);

    const processTargetAccountSM = new CfnStateMachine(
      this,
      name(buildConfig, "processTargetAccountSM"),
      {
        roleArn: processTargetAccountSMRole.roleArn,
        definitionString: JSON.stringify(processTargetAccountSMJSON),
        stateMachineName: name(buildConfig, "processTargetAccountSM"),
      }
    );

    new CrossAccountRole(
      this,
      name(buildConfig, "orgListSMRole"),
      buildConfig,
      {
        assumeAccountID: buildConfig.PipelineSettings.TargetAccountId,
        roleNameKey: "orgListSM-orgapi",
        policyStatement: new PolicyStatement({
          resources: [processTargetAccountSM.ref],
          actions: ["states:StartExecution"],
        }),
      }
    );
  }
}

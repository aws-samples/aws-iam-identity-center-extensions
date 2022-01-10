/*
Deploys Core solution components
The stack itself does not have any direct resource deployment
and abstracts all resource deployments to the constructs
*/
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BuildConfig } from "../../build/buildConfig";
import { AccessManager } from "../../constructs/access-manager";
import { FetchCrossStackValues } from "../../constructs/fetch-cross-stack-values";
import { LinkProcessor } from "../../constructs/link-processor";
import { ObservabilityArtefacts } from "../../constructs/observability-artefacts";
import { OrgEvents } from "../../constructs/org-events";
import { PermissionSetProcessor } from "../../constructs/permission-set-processor";
import { SSOGroupProcessor } from "../../constructs/sso-group-processor";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class SolutionArtefacts extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    // Deploy Solutions artefacts

    const deployFetchCrossStackValues = new FetchCrossStackValues(
      this,
      name(buildConfig, "fetchCrossStackValues"),
      buildConfig
    );

    const deployLinkProcessor = new LinkProcessor(
      this,
      name(buildConfig, "linkProcessor"),
      buildConfig,
      {
        errorNotificationsTopic:
          deployFetchCrossStackValues.errorNotificationsTopic,
        linksTable: deployFetchCrossStackValues.linksTable,
        nodeJsLayer: deployFetchCrossStackValues.nodeJsLayer,
        provisionedLinksTableName:
          deployFetchCrossStackValues.provisionedLinksTable.tableName,
        permissionSetArnTableName:
          deployFetchCrossStackValues.permissionSetArnTable.tableName,
        linkManagerHandlerSSOAPIRoleArn:
          deployFetchCrossStackValues.linkManagerHandlerSSOAPIRoleArn,
        listGroupsIdentityStoreAPIRoleArn:
          deployFetchCrossStackValues.listGroupsIdentityStoreAPIRoleArn,
        listInstancesSSOAPIRoleArn:
          deployFetchCrossStackValues.listInstancesSSOAPIRoleArn,
        orgListSMRoleArn: deployFetchCrossStackValues.orgListSMRoleArn,
        processTargetAccountSMTopic:
          deployFetchCrossStackValues.processTargetAccountSMTopic,
        linkProcessorTopic: deployFetchCrossStackValues.linkProcessorTopic,
        linkManagerQueue: deployFetchCrossStackValues.linkManagerQueue,
        waiterHandlerSSOAPIRoleArn:
          deployFetchCrossStackValues.waiterHandlerSSOAPIRoleArn,
      }
    );

    const deploySSOGroupProcessor = new SSOGroupProcessor(
      this,
      name(buildConfig, "ssoGroupProcessor"),
      buildConfig,
      {
        ssoGroupEventNotificationsTopic:
          deployFetchCrossStackValues.ssoGroupEventNotificationsTopic,
        ssoUserEventNotificationsTopic:
          deployFetchCrossStackValues.ssoUserEventNotificationsTopic,
        errorNotificationsTopicArn:
          deployFetchCrossStackValues.errorNotificationsTopic.topicArn,
        linkQueueUrl: deployFetchCrossStackValues.linkManagerQueue.queueUrl,
        linksTableName: deployFetchCrossStackValues.linksTable.tableName,
        permissionSetArnTableName:
          deployFetchCrossStackValues.permissionSetArnTable.tableName,
        nodeJsLayer: deployFetchCrossStackValues.nodeJsLayer,
        listInstancesSSOAPIRoleArn:
          deployFetchCrossStackValues.listInstancesSSOAPIRoleArn,
        listGroupsIdentityStoreAPIRoleArn:
          deployFetchCrossStackValues.listGroupsIdentityStoreAPIRoleArn,
        orgListSMRoleArn: deployFetchCrossStackValues.orgListSMRoleArn,
        processTargetAccountSMTopic:
          deployFetchCrossStackValues.processTargetAccountSMTopic,
      }
    );

    const deployPermissionSetProcessor = new PermissionSetProcessor(
      this,
      name(buildConfig, "permissionSetProcessor"),
      buildConfig,
      {
        PermissionSetArnTableName:
          deployFetchCrossStackValues.permissionSetArnTable.tableName,
        permissionSetTable: deployFetchCrossStackValues.permissionSetTable,
        errorNotificationsTopic:
          deployFetchCrossStackValues.errorNotificationsTopic,
        nodeJsLayer: deployFetchCrossStackValues.nodeJsLayer,
        permissionSetHandlerSSOAPIRoleArn:
          deployFetchCrossStackValues.permissionSetHandlerSSOAPIRoleArn,
        linkQueueUrl: deployFetchCrossStackValues.linkManagerQueue.queueUrl,
        linksTableName: deployFetchCrossStackValues.linksTable.tableName,
        listGroupsIdentityStoreAPIRoleArn:
          deployFetchCrossStackValues.listGroupsIdentityStoreAPIRoleArn,
        listInstancesSSOAPIRoleArn:
          deployFetchCrossStackValues.listInstancesSSOAPIRoleArn,
        orgListSMRoleArn: deployFetchCrossStackValues.orgListSMRoleArn,
        processTargetAccountSMTopic:
          deployFetchCrossStackValues.processTargetAccountSMTopic,
        snsTopicsKey: deployFetchCrossStackValues.snsTopicsKey,
        waiterHandlerSSOAPIRoleArn:
          deployFetchCrossStackValues.waiterHandlerSSOAPIRoleArn,
        permissionSetProcessorTopic:
          deployFetchCrossStackValues.permissionSetProcessorTopic,
      }
    );

    const deployOrgEvents = new OrgEvents(
      this,
      name(buildConfig, "orgEvents"),
      buildConfig,
      {
        errorNotificationsTopicArn:
          deployFetchCrossStackValues.errorNotificationsTopic.topicArn,
        linkQueueUrl: deployFetchCrossStackValues.linkManagerQueue.queueUrl,
        linksTableName: deployFetchCrossStackValues.linksTable.tableName,
        nodeJsLayer: deployFetchCrossStackValues.nodeJsLayer,
        orgEventsNotificationTopic:
          deployFetchCrossStackValues.orgEventsNotificationsTopic,
        permissionSetArnTableName:
          deployFetchCrossStackValues.permissionSetArnTable.tableName,
        listGroupsIdentityStoreAPIRoleArn:
          deployFetchCrossStackValues.listGroupsIdentityStoreAPIRoleArn,
        listInstancesSSOAPIRoleArn:
          deployFetchCrossStackValues.listInstancesSSOAPIRoleArn,
        provisionedlinksTableName:
          deployFetchCrossStackValues.provisionedLinksTable.tableName,
      }
    );

    new AccessManager(this, name(buildConfig, "accessManager"), {
      FetchCrossStackValues: deployFetchCrossStackValues,
      LinkProcessor: deployLinkProcessor,
      PermissionSetProcessor: deployPermissionSetProcessor,
      SSOGroupProcessor: deploySSOGroupProcessor,
      OrgEvents: deployOrgEvents,
    });

    new ObservabilityArtefacts(
      this,
      name(buildConfig, "observabilityArtefacts"),
      buildConfig
    );
  }
}

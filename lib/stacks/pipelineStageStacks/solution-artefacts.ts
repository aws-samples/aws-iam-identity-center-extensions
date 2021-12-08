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
import { OrgEvents } from "../../constructs/org-events";
import { PermissionSetProcessor } from "../../constructs/permission-set-processor";
import { SSOGroupCRUD } from "../../constructs/sso-group-crud";
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

    const deploySSOGroupCRUD = new SSOGroupCRUD(
      this,
      name(buildConfig, "ssoGroupCRUD"),
      buildConfig,
      {
        ddbTablesKey: deployFetchCrossStackValues.ddbTablesKey,
      }
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
        waiterHandlerNotificationsTopicArn:
          deployFetchCrossStackValues.waiterHandlerNotificationsTopic.topicArn,
        groupsTableName: deploySSOGroupCRUD.groupsTable.tableName,
        permissionSetArnTableName:
          deployFetchCrossStackValues.permissionSetArnTable.tableName,
        linkManagerHandlerSSOAPIRoleArn:
          deployFetchCrossStackValues.linkManagerHandlerSSOAPIRoleArn,
        listGroupsIdentityStoreAPIRoleArn:
          deployFetchCrossStackValues.listGroupsIdentityStoreAPIRoleArn,
        listInstancesSSOAPIRoleArn:
          deployFetchCrossStackValues.listInstancesSSOAPIRoleArn,
        processTargetAccountSMInvokeRoleArn:
          deployFetchCrossStackValues.processTargetAccountSMInvokeRoleArn,
        processTargetAccountSMTopic:
          deployFetchCrossStackValues.processTargetAccountSMTopic,
        snsTopicsKey: deployFetchCrossStackValues.snsTopicsKey,
      }
    );

    const deploySSOGroupProcessor = new SSOGroupProcessor(
      this,
      name(buildConfig, "ssoGroupProcessor"),
      buildConfig,
      {
        ssoGroupEventNotificationsTopic:
          deployFetchCrossStackValues.ssoGroupEventNotificationsTopic,
        errorNotificationsTopicArn:
          deployFetchCrossStackValues.errorNotificationsTopic.topicArn,
        groupsTableName: deploySSOGroupCRUD.groupsTable.tableName,
        linkManagerTopicArn: deployLinkProcessor.linkManagerTopic.topicArn,
        linksTableName: deployFetchCrossStackValues.linksTable.tableName,
        permissionSetArnTableName:
          deployFetchCrossStackValues.permissionSetArnTable.tableName,
        nodeJsLayer: deployFetchCrossStackValues.nodeJsLayer,
        listInstancesSSOAPIRoleArn:
          deployFetchCrossStackValues.listInstancesSSOAPIRoleArn,
        processTargetAccountSMInvokeRoleArn:
          deployFetchCrossStackValues.processTargetAccountSMInvokeRoleArn,
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
        waiterHandlerNotificationsTopicArn:
          deployFetchCrossStackValues.waiterHandlerNotificationsTopic.topicArn,
        permissionSetHandlerSSOAPIRoleArn:
          deployFetchCrossStackValues.permissionSetHandlerSSOAPIRoleArn,
        groupsTableName: deploySSOGroupCRUD.groupsTable.tableName,
        linkManagerTopicArn: deployLinkProcessor.linkManagerTopic.topicArn,
        linksTableName: deployFetchCrossStackValues.linksTable.tableName,
        listGroupsIdentityStoreAPIRoleArn:
          deployFetchCrossStackValues.listGroupsIdentityStoreAPIRoleArn,
        listInstancesSSOAPIRoleArn:
          deployFetchCrossStackValues.listInstancesSSOAPIRoleArn,
        processTargetAccountSMInvokeRoleArn:
          deployFetchCrossStackValues.processTargetAccountSMInvokeRoleArn,
        processTargetAccountSMTopic:
          deployFetchCrossStackValues.processTargetAccountSMTopic,
        snsTopicsKey: deployFetchCrossStackValues.snsTopicsKey,
      }
    );

    const deployOrgEvents = new OrgEvents(
      this,
      name(buildConfig, "orgEvents"),
      buildConfig,
      {
        errorNotificationsTopicArn:
          deployFetchCrossStackValues.errorNotificationsTopic.topicArn,
        groupsTableName: deploySSOGroupCRUD.groupsTable.tableName,
        linkManagerTopicArn: deployLinkProcessor.linkManagerTopic.topicArn,
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
      SSOGroupCRUD: deploySSOGroupCRUD,
      LinkProcessor: deployLinkProcessor,
      PermissionSetProcessor: deployPermissionSetProcessor,
      SSOGroupProcessor: deploySSOGroupProcessor,
      OrgEvents: deployOrgEvents,
    });
  }
}

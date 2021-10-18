/*
Deploys Core solution components
The stack itself does not have any direct resource deployment
and abstracts all resource deployments to the constructs
*/
import { Construct, Stack, StackProps } from "@aws-cdk/core";
import { BuildConfig } from "../../build/buildConfig";
import { AccessManager } from "../../constructs/access-manager";
import { IndependentUtility } from "../../constructs/independent-utlity";
import { LambdaLayers } from "../../constructs/lambda-layers";
import { LinkCRUD } from "../../constructs/link-crud";
import { LinkProcessor } from "../../constructs/link-processor";
import { OrgEvents } from "../../constructs/org-events";
import { PermissionSetCRUD } from "../../constructs/permission-set-crud";
import { PermissionSetProcessor } from "../../constructs/permission-set-processor";
import { SSOGroupCRUD } from "../../constructs/sso-group-crud";
import { SSOGroupProcessor } from "../../constructs/sso-group-processor";
import { Utility } from "../../constructs/utility";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface PreSolutionArtefactsProps {
  readonly deployIndependentUtility: IndependentUtility;
  readonly deployLambdaLayers: LambdaLayers;
  readonly deployLinkCRUD: LinkCRUD;
  readonly deployPermissionSetCRUD: PermissionSetCRUD;
  readonly deployUtility: Utility;
}

export class SolutionArtefacts extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig,
    preSolutionArtefactsProps: PreSolutionArtefactsProps
  ) {
    super(scope, id, props);

    const deploySSOGroupCRUD = new SSOGroupCRUD(
      this,
      name(buildConfig, "ssoGroupCRUD"),
      buildConfig,
      {
        ddbTablesKey:
          preSolutionArtefactsProps.deployIndependentUtility.ddbTablesKey,
      }
    );

    const deployLinkProcessor = new LinkProcessor(
      this,
      name(buildConfig, "linkProcessor"),
      buildConfig,
      {
        errorNotificationsTopic:
          preSolutionArtefactsProps.deployIndependentUtility
            .errorNotificationsTopic,
        linksTable: preSolutionArtefactsProps.deployLinkCRUD.linksTable,
        nodeJsLayer: preSolutionArtefactsProps.deployLambdaLayers.nodeJsLayer,
        provisionedLinksTableName:
          preSolutionArtefactsProps.deployLinkCRUD.provisionedLinksTable
            .tableName,
        waiterHandlerNotificationsTopicArn:
          preSolutionArtefactsProps.deployUtility
            .waiterHandlerNotificationsTopic.topicArn,
        groupsTableName: deploySSOGroupCRUD.groupsTable.tableName,
        permissionSetArnTableName:
          preSolutionArtefactsProps.deployPermissionSetCRUD
            .permissionSetArnTable.tableName,
        linkManagerHandlerSSOAPIRoleArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .linkManagerHandlerSSOAPIRoleArn,
        listGroupsIdentityStoreAPIRoleArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .listGroupsIdentityStoreAPIRoleArn,
        listInstancesSSOAPIRoleArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .listInstancesSSOAPIRoleArn,
        processTargetAccountSMInvokeRoleArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .processTargetAccountSMInvokeRoleArn,
        processTargetAccountSMTopic:
          preSolutionArtefactsProps.deployUtility.processTargetAccountSMTopic,
        snsTopicsKey:
          preSolutionArtefactsProps.deployIndependentUtility.snsTopicsKey,
      }
    );

    const deploySSOGroupProcessor = new SSOGroupProcessor(
      this,
      name(buildConfig, "ssoGroupProcessor"),
      buildConfig,
      {
        ssoGroupEventNotificationsTopic:
          preSolutionArtefactsProps.deployUtility
            .ssoGroupEventsNotificationsTopic,
        errorNotificationsTopicArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .errorNotificationsTopic.topicArn,
        groupsTableName: deploySSOGroupCRUD.groupsTable.tableName,
        linkManagerTopicArn: deployLinkProcessor.linkManagerTopic.topicArn,
        linksTableName:
          preSolutionArtefactsProps.deployLinkCRUD.linksTable.tableName,
        permissionSetArnTableName:
          preSolutionArtefactsProps.deployPermissionSetCRUD
            .permissionSetArnTable.tableName,
        nodeJsLayer: preSolutionArtefactsProps.deployLambdaLayers.nodeJsLayer,
        listInstancesSSOAPIRoleArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .listInstancesSSOAPIRoleArn,
        processTargetAccountSMInvokeRoleArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .processTargetAccountSMInvokeRoleArn,
        processTargetAccountSMTopic:
          preSolutionArtefactsProps.deployUtility.processTargetAccountSMTopic,
      }
    );

    const deployPermissionSetProcessor = new PermissionSetProcessor(
      this,
      name(buildConfig, "permissionSetProcessor"),
      buildConfig,
      {
        PermissionSetArnTableName:
          preSolutionArtefactsProps.deployPermissionSetCRUD
            .permissionSetArnTable.tableName,
        permissionSetTable:
          preSolutionArtefactsProps.deployPermissionSetCRUD.permissionSetTable,
        errorNotificationsTopic:
          preSolutionArtefactsProps.deployIndependentUtility
            .errorNotificationsTopic,
        nodeJsLayer: preSolutionArtefactsProps.deployLambdaLayers.nodeJsLayer,
        waiterHandlerNotificationsTopicArn:
          preSolutionArtefactsProps.deployUtility
            .waiterHandlerNotificationsTopic.topicArn,
        permissionSetHandlerSSOAPIRoleArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .permissionSetHandlerSSOAPIRoleArn,
        groupsTableName: deploySSOGroupCRUD.groupsTable.tableName,
        linkManagerTopicArn: deployLinkProcessor.linkManagerTopic.topicArn,
        linksTableName:
          preSolutionArtefactsProps.deployLinkCRUD.linksTable.tableName,
        listGroupsIdentityStoreAPIRoleArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .listGroupsIdentityStoreAPIRoleArn,
        listInstancesSSOAPIRoleArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .listInstancesSSOAPIRoleArn,
        processTargetAccountSMInvokeRoleArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .processTargetAccountSMInvokeRoleArn,
        processTargetAccountSMTopic:
          preSolutionArtefactsProps.deployUtility.processTargetAccountSMTopic,
        snsTopicsKey:
          preSolutionArtefactsProps.deployIndependentUtility.snsTopicsKey,
      }
    );

    const deployOrgEvents = new OrgEvents(
      this,
      name(buildConfig, "orgEvents"),
      buildConfig,
      {
        errorNotificationsTopicArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .errorNotificationsTopic.topicArn,
        groupsTableName: deploySSOGroupCRUD.groupsTable.tableName,
        linkManagerTopicArn: deployLinkProcessor.linkManagerTopic.topicArn,
        linksTableName:
          preSolutionArtefactsProps.deployLinkCRUD.linksTable.tableName,
        nodeJsLayer: preSolutionArtefactsProps.deployLambdaLayers.nodeJsLayer,
        orgEventsNotificationTopic:
          preSolutionArtefactsProps.deployUtility.orgEventsNotificationsTopic,
        permissionSetArnTableName:
          preSolutionArtefactsProps.deployPermissionSetCRUD
            .permissionSetArnTable.tableName,
        listGroupsIdentityStoreAPIRoleArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .listGroupsIdentityStoreAPIRoleArn,
        listInstancesSSOAPIRoleArn:
          preSolutionArtefactsProps.deployIndependentUtility
            .listInstancesSSOAPIRoleArn,
        provisionedlinksTableName:
          preSolutionArtefactsProps.deployLinkCRUD.provisionedLinksTable
            .tableName,
      }
    );

    new AccessManager(this, name(buildConfig, "accessManager"), buildConfig, {
      IndependentUtility: preSolutionArtefactsProps.deployIndependentUtility,
      LinkCRUD: preSolutionArtefactsProps.deployLinkCRUD,
      PermissionSetCRUD: preSolutionArtefactsProps.deployPermissionSetCRUD,
      SSOGroupCRUD: deploySSOGroupCRUD,
      Utility: preSolutionArtefactsProps.deployUtility,
      LinkProcessor: deployLinkProcessor,
      PermissionSetProcessor: deployPermissionSetProcessor,
      SSOGroupProcessor: deploySSOGroupProcessor,
      OrgEvents: deployOrgEvents,
    });
  }
}

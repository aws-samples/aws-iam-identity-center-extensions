/*
Since, there are more than 100+ resources
being created in the solutions artefact stack, 
all access granting within the stack is consolidated
here to facilitate easier management and visibility
*/

import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";
import { IndependentUtility } from "./independent-utlity";
import { LinkCRUD } from "./link-crud";
import { LinkProcessor } from "./link-processor";
import { OrgEvents } from "./org-events";
import { PermissionSetCRUD } from "./permission-set-crud";
import { PermissionSetProcessor } from "./permission-set-processor";
import { SSOGroupCRUD } from "./sso-group-crud";
import { SSOGroupProcessor } from "./sso-group-processor";
import { Utility } from "./utility";

export interface AccessManagerProps {
  readonly IndependentUtility: IndependentUtility;
  readonly LinkCRUD: LinkCRUD;
  readonly PermissionSetCRUD: PermissionSetCRUD;
  readonly SSOGroupCRUD: SSOGroupCRUD;
  readonly Utility: Utility;
  readonly LinkProcessor: LinkProcessor;
  readonly PermissionSetProcessor: PermissionSetProcessor;
  readonly SSOGroupProcessor: SSOGroupProcessor;
  readonly OrgEvents: OrgEvents;
}

export class AccessManager extends Construct {
  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    accessManagerProps: AccessManagerProps
  ) {
    super(scope, id);

    accessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
      accessManagerProps.Utility.waiterHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.Utility.waiterHandler
    );

    if (buildConfig.Parameters.LinksProvisioningMode.toLowerCase() === "api") {
      accessManagerProps.LinkCRUD.linksTable.grantReadWriteData(
        accessManagerProps.LinkCRUD.linkAPIHandler
      );

      accessManagerProps.IndependentUtility.ssoArtefactsBucket.grantReadWrite(
        accessManagerProps.LinkCRUD.linkAPIHandler
      );

      accessManagerProps.IndependentUtility.s3ArtefactsKey.grantEncryptDecrypt(
        accessManagerProps.LinkCRUD.linkAPIHandler
      );
    } else {
      accessManagerProps.LinkCRUD.linksTable.grantReadWriteData(
        accessManagerProps.LinkCRUD.linkCuHandler
      );
      accessManagerProps.LinkCRUD.linksTable.grantReadWriteData(
        accessManagerProps.LinkCRUD.linkDelHandler
      );
      accessManagerProps.IndependentUtility.ssoArtefactsBucket.grantRead(
        accessManagerProps.LinkCRUD.linkCuHandler
      );
      accessManagerProps.IndependentUtility.s3ArtefactsKey.grantEncryptDecrypt(
        accessManagerProps.LinkCRUD.linkCuHandler
      );
      accessManagerProps.IndependentUtility.ssoArtefactsBucket.grantRead(
        accessManagerProps.LinkCRUD.linkDelHandler
      );
      accessManagerProps.IndependentUtility.s3ArtefactsKey.grantEncryptDecrypt(
        accessManagerProps.LinkCRUD.linkDelHandler
      );
      accessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
        accessManagerProps.LinkCRUD.linkCuHandler
      );
      accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
        accessManagerProps.LinkCRUD.linkCuHandler
      );
      accessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
        accessManagerProps.LinkCRUD.linkDelHandler
      );
      accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
        accessManagerProps.LinkCRUD.linkDelHandler
      );
    }

    if (
      buildConfig.Parameters.PermissionSetProvisioningMode.toLowerCase() ===
      "api"
    ) {
      accessManagerProps.LinkCRUD.linksTable.grantReadData(
        accessManagerProps.PermissionSetCRUD.permissionSetAPIHandler
      );
      accessManagerProps.PermissionSetCRUD.permissionSetTable.grantReadWriteData(
        accessManagerProps.PermissionSetCRUD.permissionSetAPIHandler
      );

      accessManagerProps.IndependentUtility.ssoArtefactsBucket.grantReadWrite(
        accessManagerProps.PermissionSetCRUD.permissionSetAPIHandler
      );
      accessManagerProps.IndependentUtility.s3ArtefactsKey.grantEncryptDecrypt(
        accessManagerProps.PermissionSetCRUD.permissionSetAPIHandler
      );
    } else {
      accessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
        accessManagerProps.PermissionSetCRUD.permissionSetCuHandler
      );
      accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
        accessManagerProps.PermissionSetCRUD.permissionSetCuHandler
      );
      accessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
        accessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
      accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
        accessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
      accessManagerProps.LinkCRUD.linksTable.grantReadData(
        accessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
      accessManagerProps.PermissionSetCRUD.permissionSetTable.grantReadWriteData(
        accessManagerProps.PermissionSetCRUD.permissionSetCuHandler
      );
      accessManagerProps.PermissionSetCRUD.permissionSetTable.grantReadWriteData(
        accessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
      accessManagerProps.IndependentUtility.ssoArtefactsBucket.grantRead(
        accessManagerProps.PermissionSetCRUD.permissionSetCuHandler
      );
      accessManagerProps.IndependentUtility.s3ArtefactsKey.grantDecrypt(
        accessManagerProps.PermissionSetCRUD.permissionSetCuHandler
      );

      accessManagerProps.IndependentUtility.ssoArtefactsBucket.grantRead(
        accessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
      accessManagerProps.IndependentUtility.s3ArtefactsKey.grantDecrypt(
        accessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
    }

    accessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
      accessManagerProps.LinkProcessor.linkManagerHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkManagerHandler
    );

    accessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );

    accessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetStreamHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetStreamHandler
    );

    accessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );

    accessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
      accessManagerProps.LinkProcessor.linkStreamHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkStreamHandler
    );

    accessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
      accessManagerProps.OrgEvents.orgEventsHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.OrgEvents.orgEventsHandler
    );

    accessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );

    accessManagerProps.PermissionSetCRUD.permissionSetTable.grantStreamRead(
      accessManagerProps.PermissionSetProcessor.permissionSetStreamHandler
    );
    accessManagerProps.LinkCRUD.linksTable.grantStreamRead(
      accessManagerProps.LinkProcessor.linkStreamHandler
    );
    accessManagerProps.PermissionSetProcessor.permissionSetTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetStreamHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetStreamHandler
    );

    accessManagerProps.PermissionSetProcessor.permissionSetSyncTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );

    accessManagerProps.LinkProcessor.linkManagerTopic.grantPublish(
      accessManagerProps.LinkProcessor.linkStreamHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkStreamHandler
    );

    accessManagerProps.PermissionSetCRUD.permissionSetTable.grantReadWriteData(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );
    accessManagerProps.PermissionSetCRUD.permissionSetArnTable.grantReadWriteData(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );

    accessManagerProps.SSOGroupCRUD.groupsTable.grantReadWriteData(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );

    accessManagerProps.SSOGroupCRUD.groupsTable.grantReadData(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );

    accessManagerProps.SSOGroupCRUD.groupsTable.grantReadWriteData(
      accessManagerProps.OrgEvents.orgEventsHandler
    );
    accessManagerProps.SSOGroupCRUD.groupsTable.grantReadWriteData(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );
    accessManagerProps.LinkCRUD.linksTable.grantReadWriteData(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );

    accessManagerProps.LinkCRUD.linksTable.grantReadData(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );

    accessManagerProps.LinkProcessor.linkManagerTopic.grantPublish(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );
    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );
    accessManagerProps.LinkProcessor.linkManagerTopic.grantPublish(
      accessManagerProps.OrgEvents.orgEventsHandler
    );
    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.OrgEvents.orgEventsHandler
    );
    accessManagerProps.LinkProcessor.linkManagerTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );
    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );

    accessManagerProps.LinkProcessor.linkManagerTopic.grantPublish(
      accessManagerProps.LinkProcessor.processTargetAccountSMListenerHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.processTargetAccountSMListenerHandler
    );

    accessManagerProps.LinkCRUD.linksTable.grantReadData(
      accessManagerProps.LinkProcessor.linkStreamHandler
    );
    accessManagerProps.SSOGroupCRUD.groupsTable.grantReadWriteData(
      accessManagerProps.LinkProcessor.linkStreamHandler
    );
    accessManagerProps.LinkCRUD.linksTable.grantReadWriteData(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );

    accessManagerProps.LinkCRUD.linksTable.grantReadData(
      accessManagerProps.OrgEvents.orgEventsHandler
    );

    accessManagerProps.PermissionSetCRUD.permissionSetArnTable.grantReadData(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );
    accessManagerProps.PermissionSetCRUD.permissionSetArnTable.grantReadData(
      accessManagerProps.LinkProcessor.linkStreamHandler
    );
    accessManagerProps.PermissionSetCRUD.permissionSetArnTable.grantReadData(
      accessManagerProps.OrgEvents.orgEventsHandler
    );

    accessManagerProps.LinkCRUD.provisionedLinksTable.grantReadData(
      accessManagerProps.LinkProcessor.linkManagerHandler
    );
    accessManagerProps.LinkCRUD.provisionedLinksTable.grantReadWriteData(
      accessManagerProps.Utility.waiterHandler
    );

    accessManagerProps.Utility.waiterHandlerNotificationsTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );

    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );

    accessManagerProps.Utility.waiterHandlerNotificationsTopic.grantPublish(
      accessManagerProps.LinkProcessor.linkManagerHandler
    );
    accessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkManagerHandler
    );

    accessManagerProps.IndependentUtility.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkStreamHandler
    );

    accessManagerProps.IndependentUtility.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetStreamHandler
    );

    accessManagerProps.LinkCRUD.provisionedLinksTable.grantReadData(
      accessManagerProps.OrgEvents.orgEventsHandler
    );

    accessManagerProps.LinkProcessor.linkManagerHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.IndependentUtility.linkManagerHandlerSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );

    accessManagerProps.LinkProcessor.linkStreamHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.IndependentUtility.listInstancesSSOAPIRoleArn,
          accessManagerProps.IndependentUtility
            .listGroupsIdentityStoreAPIRoleArn,
          accessManagerProps.IndependentUtility
            .processTargetAccountSMInvokeRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );

    accessManagerProps.OrgEvents.orgEventsHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.IndependentUtility.listInstancesSSOAPIRoleArn,
          accessManagerProps.IndependentUtility
            .listGroupsIdentityStoreAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );

    accessManagerProps.PermissionSetProcessor.permissionSetHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.IndependentUtility
            .permissionSetHandlerSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );

    accessManagerProps.SSOGroupProcessor.ssoGroupHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.IndependentUtility
            .processTargetAccountSMInvokeRoleArn,
          accessManagerProps.IndependentUtility.listInstancesSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );

    accessManagerProps.Utility.waiterHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.IndependentUtility.waiterHandlerSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );

    accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.IndependentUtility.listInstancesSSOAPIRoleArn,
          accessManagerProps.IndependentUtility
            .listGroupsIdentityStoreAPIRoleArn,
          accessManagerProps.IndependentUtility
            .processTargetAccountSMInvokeRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );
  }
}

/*
All access granting within the solution artefacts stack is consolidated
here to facilitate easier management and visibility
*/

import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { FetchCrossStackValues } from "./fetch-cross-stack-values";
import { LinkProcessor } from "./link-processor";
import { OrgEvents } from "./org-events";
import { PermissionSetProcessor } from "./permission-set-processor";
import { SSOGroupCRUD } from "./sso-group-crud";
import { SSOGroupProcessor } from "./sso-group-processor";

export interface AccessManagerProps {
  readonly FetchCrossStackValues: FetchCrossStackValues;
  readonly SSOGroupCRUD: SSOGroupCRUD;
  readonly LinkProcessor: LinkProcessor;
  readonly PermissionSetProcessor: PermissionSetProcessor;
  readonly SSOGroupProcessor: SSOGroupProcessor;
  readonly OrgEvents: OrgEvents;
}

export class AccessManager extends Construct {
  constructor(
    scope: Construct,
    id: string,
    accessManagerProps: AccessManagerProps
  ) {
    super(scope, id);

    // Link Manager Handler access
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkManagerHandler
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantConsumeMessages(
      accessManagerProps.LinkProcessor.linkManagerHandler
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkManagerHandler
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.LinkProcessor.linkManagerHandler
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkManagerHandler
    );
    accessManagerProps.FetchCrossStackValues.provisionedLinksTable.grantReadWriteData(
      accessManagerProps.LinkProcessor.linkManagerHandler
    );
    accessManagerProps.LinkProcessor.linkManagerHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues
            .linkManagerHandlerSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );
    accessManagerProps.LinkProcessor.linkManagerHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues.waiterHandlerSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );

    // Permission Set Topic Handler access
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );
    accessManagerProps.PermissionSetProcessor.permissionSetSyncTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );
    accessManagerProps.FetchCrossStackValues.permissionSetTable.grantReadWriteData(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );
    accessManagerProps.FetchCrossStackValues.permissionSetArnTable.grantReadWriteData(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );
    accessManagerProps.SSOGroupCRUD.groupsTable.grantReadData(
      accessManagerProps.PermissionSetProcessor.permissionSetHandler
    );
    accessManagerProps.PermissionSetProcessor.permissionSetHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues
            .permissionSetHandlerSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );
    accessManagerProps.PermissionSetProcessor.permissionSetHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues.waiterHandlerSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );

    // Permission Set Stream Handler access
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetStreamHandler
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetStreamHandler
    );
    accessManagerProps.PermissionSetProcessor.permissionSetTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetStreamHandler
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetStreamHandler
    );
    accessManagerProps.FetchCrossStackValues.permissionSetTable.grantStreamRead(
      accessManagerProps.PermissionSetProcessor.permissionSetStreamHandler
    );

    // SSO Group Handler access
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantSendMessages(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );
    accessManagerProps.SSOGroupCRUD.groupsTable.grantReadWriteData(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );
    accessManagerProps.FetchCrossStackValues.linksTable.grantReadWriteData(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );
    accessManagerProps.FetchCrossStackValues.permissionSetArnTable.grantReadData(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler
    );

    accessManagerProps.SSOGroupProcessor.ssoGroupHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues
            .processTargetAccountSMInvokeRoleArn,
          accessManagerProps.FetchCrossStackValues.listInstancesSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );

    // Link topic processor access
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkTopicProcessor
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantSendMessages(
      accessManagerProps.LinkProcessor.linkTopicProcessor
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkTopicProcessor
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.LinkProcessor.linkTopicProcessor
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkTopicProcessor
    );
    accessManagerProps.FetchCrossStackValues.linksTable.grantReadData(
      accessManagerProps.LinkProcessor.linkTopicProcessor
    );
    accessManagerProps.SSOGroupCRUD.groupsTable.grantReadWriteData(
      accessManagerProps.LinkProcessor.linkTopicProcessor
    );
    accessManagerProps.FetchCrossStackValues.permissionSetArnTable.grantReadData(
      accessManagerProps.LinkProcessor.linkTopicProcessor
    );
    accessManagerProps.LinkProcessor.linkTopicProcessor.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues.listInstancesSSOAPIRoleArn,
          accessManagerProps.FetchCrossStackValues
            .listGroupsIdentityStoreAPIRoleArn,
          accessManagerProps.FetchCrossStackValues
            .processTargetAccountSMInvokeRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );

    // Org Events Handler Access
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.OrgEvents.orgEventsHandler
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantSendMessages(
      accessManagerProps.OrgEvents.orgEventsHandler
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.OrgEvents.orgEventsHandler
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.OrgEvents.orgEventsHandler
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.OrgEvents.orgEventsHandler
    );
    accessManagerProps.SSOGroupCRUD.groupsTable.grantReadWriteData(
      accessManagerProps.OrgEvents.orgEventsHandler
    );
    accessManagerProps.FetchCrossStackValues.linksTable.grantReadData(
      accessManagerProps.OrgEvents.orgEventsHandler
    );
    accessManagerProps.FetchCrossStackValues.permissionSetArnTable.grantReadData(
      accessManagerProps.OrgEvents.orgEventsHandler
    );
    accessManagerProps.FetchCrossStackValues.provisionedLinksTable.grantReadData(
      accessManagerProps.OrgEvents.orgEventsHandler
    );

    accessManagerProps.OrgEvents.orgEventsHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues.listInstancesSSOAPIRoleArn,
          accessManagerProps.FetchCrossStackValues
            .listGroupsIdentityStoreAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );

    // Permission Set Sync Handler access
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantSendMessages(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );
    accessManagerProps.SSOGroupCRUD.groupsTable.grantReadWriteData(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );
    accessManagerProps.FetchCrossStackValues.linksTable.grantReadData(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler
    );

    accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues.listInstancesSSOAPIRoleArn,
          accessManagerProps.FetchCrossStackValues
            .listGroupsIdentityStoreAPIRoleArn,
          accessManagerProps.FetchCrossStackValues
            .processTargetAccountSMInvokeRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      })
    );

    //Process Target account SM Listener access
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.processTargetAccountSMListenerHandler
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantSendMessages(
      accessManagerProps.LinkProcessor.processTargetAccountSMListenerHandler
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.processTargetAccountSMListenerHandler
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.LinkProcessor.processTargetAccountSMListenerHandler
    );
  }
}

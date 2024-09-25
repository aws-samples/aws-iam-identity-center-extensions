/**
 * This construct manages access entitlements between different resources
 * created by the solution as part of "Solution-Artefacts" stack in "target"
 * account Where feasible, access management is centralised in this construct.
 * Exceptions are when the underlying resources cannot be referenced in the
 * "Solution-Artefacts" stack, or when managing access entitlements this way
 * creates circular dependencies
 */
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Construct } from "constructs";
import { FetchCrossStackValues } from "./fetch-cross-stack-values";
import { LinkProcessor } from "./link-processor";
import { OrgEvents } from "./org-events";
import { PermissionSetProcessor } from "./permission-set-processor";
import { SSOGroupProcessor } from "./sso-group-processor";

export interface AccessManagerProps {
  readonly FetchCrossStackValues: FetchCrossStackValues;
  readonly LinkProcessor: LinkProcessor;
  readonly PermissionSetProcessor: PermissionSetProcessor;
  readonly SSOGroupProcessor: SSOGroupProcessor;
  readonly OrgEvents: OrgEvents;
}

export class AccessManager extends Construct {
  constructor(
    scope: Construct,
    id: string,
    accessManagerProps: AccessManagerProps,
  ) {
    super(scope, id);

    /**
     * All required access for account assignment provisioning handler
     * lib/lambda-functions/application-handlers/linkManager.ts
     */
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkManagerHandler,
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantConsumeMessages(
      accessManagerProps.LinkProcessor.linkManagerHandler,
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkManagerHandler,
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.LinkProcessor.linkManagerHandler,
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkManagerHandler,
    );
    accessManagerProps.FetchCrossStackValues.provisionedLinksTable.grantReadWriteData(
      accessManagerProps.LinkProcessor.linkManagerHandler,
    );
    accessManagerProps.LinkProcessor.linkManagerHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues
            .linkManagerHandlerSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      }),
    );
    accessManagerProps.LinkProcessor.linkManagerHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues.waiterHandlerSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      }),
    );

    /**
     * All required access for permission set provisioning handler
     * lib/lambda-functions/application-handlers/permissionSetTopicProcessor.ts
     */
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetTopicProcessor,
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetTopicProcessor,
    );
    accessManagerProps.PermissionSetProcessor.permissionSetSyncTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetTopicProcessor,
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetTopicProcessor,
    );
    accessManagerProps.FetchCrossStackValues.permissionSetTable.grantReadWriteData(
      accessManagerProps.PermissionSetProcessor.permissionSetTopicProcessor,
    );
    accessManagerProps.FetchCrossStackValues.permissionSetArnTable.grantReadWriteData(
      accessManagerProps.PermissionSetProcessor.permissionSetTopicProcessor,
    );
    accessManagerProps.PermissionSetProcessor.permissionSetTopicProcessor.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues
            .permissionSetHandlerSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      }),
    );
    accessManagerProps.PermissionSetProcessor.permissionSetTopicProcessor.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues.waiterHandlerSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      }),
    );
    accessManagerProps.PermissionSetProcessor.managedPolicyQueueProcessor.addToRolePolicy(
      new PolicyStatement({
        resources: [accessManagerProps.FetchCrossStackValues.ssoMpRoleArn],
        actions: ["sts:AssumeRole"],
      }),
    );
    accessManagerProps.PermissionSetProcessor.managedPolicyQueue.grantSendMessages(
      accessManagerProps.PermissionSetProcessor.permissionSetTopicProcessor,
    );

    /**
     * All required access for self-sustaining flow on AWS IAM Identity Center
     * group creation/deletion
     * lib/lambda-functions/application-handlers/groupsCud.ts
     */
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler,
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantSendMessages(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler,
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler,
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler,
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler,
    );
    accessManagerProps.FetchCrossStackValues.linksTable.grantReadWriteData(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler,
    );
    accessManagerProps.FetchCrossStackValues.permissionSetArnTable.grantReadData(
      accessManagerProps.SSOGroupProcessor.ssoGroupHandler,
    );
    accessManagerProps.SSOGroupProcessor.ssoGroupHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues.orgListSMRoleArn,
          accessManagerProps.FetchCrossStackValues.listInstancesSSOAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      }),
    );

    /**
     * All required access for self-sustaining flow on AWS IAM Identity Center
     * user creation/deletion
     * lib/lambda-functions/application-handlers/usersCud.ts
     */
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.SSOGroupProcessor.ssoUserHandler,
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantSendMessages(
      accessManagerProps.SSOGroupProcessor.ssoUserHandler,
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.SSOGroupProcessor.ssoUserHandler,
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.SSOGroupProcessor.ssoUserHandler,
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.SSOGroupProcessor.ssoUserHandler,
    );
    accessManagerProps.FetchCrossStackValues.linksTable.grantReadWriteData(
      accessManagerProps.SSOGroupProcessor.ssoUserHandler,
    );
    accessManagerProps.FetchCrossStackValues.permissionSetArnTable.grantReadData(
      accessManagerProps.SSOGroupProcessor.ssoUserHandler,
    );
    accessManagerProps.SSOGroupProcessor.ssoUserHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues.orgListSMRoleArn,
          accessManagerProps.FetchCrossStackValues.listInstancesSSOAPIRoleArn,
          accessManagerProps.FetchCrossStackValues
            .listGroupsIdentityStoreAPIRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      }),
    );

    /**
     * All required access for account assignment dispatch handler
     * lib/lambda-functions/application-handlers/linkTopicProcessor.ts
     */
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkTopicProcessor,
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantSendMessages(
      accessManagerProps.LinkProcessor.linkTopicProcessor,
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkTopicProcessor,
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.LinkProcessor.linkTopicProcessor,
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.linkTopicProcessor,
    );
    accessManagerProps.FetchCrossStackValues.linksTable.grantReadData(
      accessManagerProps.LinkProcessor.linkTopicProcessor,
    );
    accessManagerProps.FetchCrossStackValues.permissionSetArnTable.grantReadData(
      accessManagerProps.LinkProcessor.linkTopicProcessor,
    );
    accessManagerProps.LinkProcessor.linkTopicProcessor.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues.listInstancesSSOAPIRoleArn,
          accessManagerProps.FetchCrossStackValues
            .listGroupsIdentityStoreAPIRoleArn,
          accessManagerProps.FetchCrossStackValues.orgListSMRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      }),
    );

    /**
     * All required access for self-sustaining flow on org events -
     * CreateAccount, MoveAccount, account tag operations
     * lib/lambda-functions/application-handlers/orgEvents.ts
     */
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.OrgEvents.orgEventsHandler,
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantSendMessages(
      accessManagerProps.OrgEvents.orgEventsHandler,
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.OrgEvents.orgEventsHandler,
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.OrgEvents.orgEventsHandler,
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.OrgEvents.orgEventsHandler,
    );
    accessManagerProps.FetchCrossStackValues.linksTable.grantReadData(
      accessManagerProps.OrgEvents.orgEventsHandler,
    );
    accessManagerProps.FetchCrossStackValues.permissionSetArnTable.grantReadData(
      accessManagerProps.OrgEvents.orgEventsHandler,
    );
    accessManagerProps.FetchCrossStackValues.provisionedLinksTable.grantReadData(
      accessManagerProps.OrgEvents.orgEventsHandler,
    );

    accessManagerProps.OrgEvents.orgEventsHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues.listInstancesSSOAPIRoleArn,
          accessManagerProps.FetchCrossStackValues
            .listGroupsIdentityStoreAPIRoleArn,
          accessManagerProps.FetchCrossStackValues.orgListParentsRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      }),
    );

    /**
     * All required access for self-sustaining flow on permission set changes
     * lib/lambda-functions/application-handlers/permissionSetSync.ts
     */
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler,
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantSendMessages(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler,
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler,
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler,
    );
    accessManagerProps.FetchCrossStackValues.ddbTablesKey.grantEncryptDecrypt(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler,
    );
    accessManagerProps.FetchCrossStackValues.linksTable.grantReadData(
      accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler,
    );

    accessManagerProps.PermissionSetProcessor.permissionSetSyncHandler.addToRolePolicy(
      new PolicyStatement({
        resources: [
          accessManagerProps.FetchCrossStackValues.listInstancesSSOAPIRoleArn,
          accessManagerProps.FetchCrossStackValues
            .listGroupsIdentityStoreAPIRoleArn,
          accessManagerProps.FetchCrossStackValues.orgListSMRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      }),
    );

    /**
     * All required access for account assignment dispatcher on target account
     * list discovery
     * lib/lambda-functions/application-handlers/processTargetAccountSMListener.ts
     */
    accessManagerProps.FetchCrossStackValues.queuesKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.processTargetAccountSMListenerHandler,
    );
    accessManagerProps.FetchCrossStackValues.linkManagerQueue.grantSendMessages(
      accessManagerProps.LinkProcessor.processTargetAccountSMListenerHandler,
    );
    accessManagerProps.FetchCrossStackValues.snsTopicsKey.grantEncryptDecrypt(
      accessManagerProps.LinkProcessor.processTargetAccountSMListenerHandler,
    );
    accessManagerProps.FetchCrossStackValues.errorNotificationsTopic.grantPublish(
      accessManagerProps.LinkProcessor.processTargetAccountSMListenerHandler,
    );
  }
}

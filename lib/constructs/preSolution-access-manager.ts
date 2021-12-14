/*
All access granting within the preSolution artefacts stack is consolidated
here to facilitate easier management and visibility
*/

import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";
import { IndependentUtility } from "./independent-utlity";
import { LinkCRUD } from "./link-crud";
import { PermissionSetCRUD } from "./permission-set-crud";
import { Utility } from "./utility";

export interface PreSolutionAccessManagerProps {
  readonly PermissionSetCRUD: PermissionSetCRUD;
  readonly LinkCRUD: LinkCRUD;
  readonly Utility: Utility;
  readonly IndependentUtility: IndependentUtility;
}

export class PreSolutionAccessManager extends Construct {
  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    preSolutionAccessManagerProps: PreSolutionAccessManagerProps
  ) {
    super(scope, id);

    // Import interfaces access

    if (buildConfig.Parameters.LinksProvisioningMode.toLowerCase() === "api") {
      // Link - API interface mode

      preSolutionAccessManagerProps.IndependentUtility.ddbTablesKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.LinkCRUD.linkAPIHandler
      );
      preSolutionAccessManagerProps.LinkCRUD.linksTable.grantReadWriteData(
        preSolutionAccessManagerProps.LinkCRUD.linkAPIHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.s3ArtefactsKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.LinkCRUD.linkAPIHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.ssoArtefactsBucket.grantReadWrite(
        preSolutionAccessManagerProps.LinkCRUD.linkAPIHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.LinkCRUD.linkAPIHandler
      );
      preSolutionAccessManagerProps.LinkCRUD.linkProcessingTopic.grantPublish(
        preSolutionAccessManagerProps.LinkCRUD.linkAPIHandler
      );
    } else {
      // Link - S3 interface mode

      preSolutionAccessManagerProps.IndependentUtility.ddbTablesKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.LinkCRUD.linkCuHandler
      );
      preSolutionAccessManagerProps.LinkCRUD.linksTable.grantReadWriteData(
        preSolutionAccessManagerProps.LinkCRUD.linkCuHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.ddbTablesKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.LinkCRUD.linkDelHandler
      );
      preSolutionAccessManagerProps.LinkCRUD.linksTable.grantReadWriteData(
        preSolutionAccessManagerProps.LinkCRUD.linkDelHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.LinkCRUD.linkCuHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.LinkCRUD.linkDelHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
        preSolutionAccessManagerProps.LinkCRUD.linkCuHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
        preSolutionAccessManagerProps.LinkCRUD.linkDelHandler
      );
      preSolutionAccessManagerProps.LinkCRUD.linkProcessingTopic.grantPublish(
        preSolutionAccessManagerProps.LinkCRUD.linkCuHandler
      );
      preSolutionAccessManagerProps.LinkCRUD.linkProcessingTopic.grantPublish(
        preSolutionAccessManagerProps.LinkCRUD.linkDelHandler
      );
    }

    if (
      buildConfig.Parameters.PermissionSetProvisioningMode.toLowerCase() ===
      "api"
    ) {
      // PermissionSet - API interface mode

      preSolutionAccessManagerProps.IndependentUtility.ddbTablesKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetAPIHandler
      );
      preSolutionAccessManagerProps.LinkCRUD.linksTable.grantReadData(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetAPIHandler
      );
      preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetTable.grantReadWriteData(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetAPIHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.s3ArtefactsKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetAPIHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.ssoArtefactsBucket.grantReadWrite(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetAPIHandler
      );
    } else {
      // PermissionSet - S3 interface mode

      preSolutionAccessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetCuHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetCuHandler
      );

      preSolutionAccessManagerProps.IndependentUtility.snsTopicsKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.errorNotificationsTopic.grantPublish(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.ddbTablesKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetCuHandler
      );
      preSolutionAccessManagerProps.LinkCRUD.linksTable.grantReadData(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
      preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetTable.grantReadWriteData(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetCuHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.ddbTablesKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
      preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetTable.grantReadWriteData(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.s3ArtefactsKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetCuHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.ssoArtefactsBucket.grantRead(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetCuHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.s3ArtefactsKey.grantEncryptDecrypt(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
      preSolutionAccessManagerProps.IndependentUtility.ssoArtefactsBucket.grantRead(
        preSolutionAccessManagerProps.PermissionSetCRUD.permissionSetDelHandler
      );
    }
  }
}

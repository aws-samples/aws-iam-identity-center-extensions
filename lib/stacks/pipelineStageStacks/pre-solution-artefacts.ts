/**
 * Deploys Core solution components The stack itself does not have any direct
 * resource deployment and abstracts all resource deployments to the constructs
 */
import { Stack, StackProps } from "aws-cdk-lib";
import { Construct } from "constructs";
import { BuildConfig } from "../../build/buildConfig";
import { IndependentUtility } from "../../constructs/independent-utlity";
import { LambdaLayers } from "../../constructs/lambda-layers";
import { LinkCRUD } from "../../constructs/link-crud";
import { PermissionSetCRUD } from "../../constructs/permission-set-crud";
import { PreSolutionAccessManager } from "../../constructs/preSolution-access-manager";
import { Utility } from "../../constructs/utility";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class PreSolutionArtefacts extends Stack {
  public readonly deployIndependentUtility: IndependentUtility;
  public readonly deployLambdaLayers: LambdaLayers;
  public readonly deployLinkCRUD: LinkCRUD;
  public readonly deployUtility: Utility;
  public readonly deployPermissionSetCRUD: PermissionSetCRUD;
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    this.deployLambdaLayers = new LambdaLayers(
      this,
      name(buildConfig, "lambdaLayers"),
      buildConfig
    );

    this.deployIndependentUtility = new IndependentUtility(
      this,
      name(buildConfig, "independentUtility"),
      buildConfig
    );

    this.deployLinkCRUD = new LinkCRUD(
      this,
      name(buildConfig, "linkCRUD"),
      buildConfig,
      {
        nodeJsLayer: this.deployLambdaLayers.nodeJsLayer,
        errorNotificationsTopicArn:
          this.deployIndependentUtility.errorNotificationsTopic.topicArn,
        ssoArtefactsBucket: this.deployIndependentUtility.ssoArtefactsBucket,
        ddbTablesKey: this.deployIndependentUtility.ddbTablesKey,
        logsKey: this.deployIndependentUtility.logsKey,
        snsTopicsKey: this.deployIndependentUtility.snsTopicsKey,
      }
    );

    this.deployUtility = new Utility(
      this,
      name(buildConfig, "utility"),
      buildConfig
    );

    this.deployPermissionSetCRUD = new PermissionSetCRUD(
      this,
      name(buildConfig, "permissionSetCRUD"),
      buildConfig,
      {
        nodeJsLayer: this.deployLambdaLayers.nodeJsLayer,
        linksTableName: this.deployLinkCRUD.linksTable.tableName,
        errorNotificationsTopicArn:
          this.deployIndependentUtility.errorNotificationsTopic.topicArn,
        ssoArtefactsBucket: this.deployIndependentUtility.ssoArtefactsBucket,
        ddbTablesKey: this.deployIndependentUtility.ddbTablesKey,
        logsKey: this.deployIndependentUtility.logsKey,
        snsTopicsKey: this.deployIndependentUtility.snsTopicsKey,
      }
    );

    new PreSolutionAccessManager(
      this,
      name(buildConfig, "preSolutionAccessManager"),
      buildConfig,
      {
        IndependentUtility: this.deployIndependentUtility,
        LinkCRUD: this.deployLinkCRUD,
        PermissionSetCRUD: this.deployPermissionSetCRUD,
        Utility: this.deployUtility,
      }
    );
  }
}

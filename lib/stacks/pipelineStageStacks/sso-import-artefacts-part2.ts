/**
 * Deploys part 2 of artefacts required for importing current AWS SSO
 * configuration i.e. permission sets and account assignments in target account
 */
import { CustomResource, Duration, Stack, StackProps } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { Architecture } from "aws-cdk-lib/aws-lambda";
import { SnsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../../build/buildConfig";
import { ImportArtefacts } from "../../constructs/import-artefacts";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class SSOImportArtefactsPart2 extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    const deployImportArtefacts = new ImportArtefacts(
      this,
      name(buildConfig, "deployImportArtefacts"),
      buildConfig
    );

    const importAccountAssignmentHandler = new NodejsFunction(
      this,
      name(buildConfig, `importAccountAssignmentHandler`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        functionName: name(buildConfig, `importAccountAssignmentHandler`),
        layers: [deployImportArtefacts.nodeJsLayer],
        entry: join(
          __dirname,
          "../../../",
          "lib",
          "lambda-functions",
          "current-config-handlers",
          "src",
          "import-account-assignments.ts"
        ),
        bundling: {
          externalModules: [
            "uuid",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-s3",
          ],
          minify: true,
        },
        environment: {
          linksTableName: deployImportArtefacts.importedLinksTable.tableName,
          provisionedLinksTableName:
            deployImportArtefacts.importedProvisionedLinksTable.tableName,
          artefactsBucketName:
            deployImportArtefacts.importedSsoArtefactsBucket.bucketName,
          functionLogMode: buildConfig.Parameters.FunctionLogMode,
        },
      }
    );

    deployImportArtefacts.importedddbTablesKey.grantEncryptDecrypt(
      importAccountAssignmentHandler
    );

    deployImportArtefacts.importedLinksTable.grantReadWriteData(
      importAccountAssignmentHandler
    );
    deployImportArtefacts.importedProvisionedLinksTable.grantReadWriteData(
      importAccountAssignmentHandler
    );

    deployImportArtefacts.importedSsoArtefactsBucket.grantReadWrite(
      importAccountAssignmentHandler
    );

    importAccountAssignmentHandler.addEventSource(
      new SnsEventSource(deployImportArtefacts.accountAssignmentImportTopic)
    );

    const importPermissionSetHandler = new NodejsFunction(
      this,
      name(buildConfig, `importPermissionSetHandler`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        functionName: name(buildConfig, `importPermissionSetHandler`),
        layers: [deployImportArtefacts.nodeJsLayer],
        entry: join(
          __dirname,
          "../../../",
          "lib",
          "lambda-functions",
          "current-config-handlers",
          "src",
          "import-permission-sets.ts"
        ),
        bundling: {
          externalModules: [
            "uuid",
            "json-diff",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/client-sso-admin",
            "@aws-sdk/credential-providers",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-s3",
          ],
          minify: true,
        },
        environment: {
          permissionSetTableName:
            deployImportArtefacts.importedPsTable.tableName,
          permissionSetArnTableName:
            deployImportArtefacts.importedPsArnTable.tableName,
          SSOAPIRoleArn:
            deployImportArtefacts.importedPermissionSetHandlerSSOAPIRoleArn,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          artefactsBucketName:
            deployImportArtefacts.importedSsoArtefactsBucket.bucketName,
          functionLogMode: buildConfig.Parameters.FunctionLogMode,
        },
      }
    );

    deployImportArtefacts.importedddbTablesKey.grantEncryptDecrypt(
      importPermissionSetHandler
    );

    deployImportArtefacts.importedPsTable.grantReadWriteData(
      importPermissionSetHandler
    );
    deployImportArtefacts.importedPsArnTable.grantReadWriteData(
      importPermissionSetHandler
    );

    deployImportArtefacts.importedSsoArtefactsBucket.grantReadWrite(
      importPermissionSetHandler
    );

    importPermissionSetHandler.addEventSource(
      new SnsEventSource(deployImportArtefacts.permissionSetImportTopic)
    );

    if (importPermissionSetHandler.role) {
      importPermissionSetHandler.addToRolePolicy(
        new PolicyStatement({
          resources: [
            deployImportArtefacts.importedPermissionSetHandlerSSOAPIRoleArn,
          ],
          actions: ["sts:AssumeRole"],
        })
      );
    }

    const updateCustomResourceHandler = new NodejsFunction(
      this,
      name(buildConfig, `updateCustomResourceHandler`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        functionName: name(buildConfig, `updateCustomResourceHandler`),
        layers: [deployImportArtefacts.nodeJsLayer],
        entry: join(
          __dirname,
          "../../../",
          "lib",
          "lambda-functions",
          "current-config-handlers",
          "src",
          "update-custom-resource.ts"
        ),
        bundling: {
          externalModules: [
            "@aws-sdk/client-sfn",
            "@aws-sdk/credential-providers",
          ],
          minify: true,
        },
        environment: {
          smDescribeRoleArn:
            deployImportArtefacts.currentConfigSMDescribeRoleArn,
          ssoAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          functionLogMode: buildConfig.Parameters.FunctionLogMode,
        },
      }
    );

    if (updateCustomResourceHandler.role) {
      updateCustomResourceHandler.addToRolePolicy(
        new PolicyStatement({
          resources: [deployImportArtefacts.currentConfigSMDescribeRoleArn],
          actions: ["sts:AssumeRole"],
        })
      );
    }

    const parentSMInvokePolicy = new PolicyStatement({
      resources: [deployImportArtefacts.currentConfigSMInvokeRoleArn],
      actions: ["sts:AssumeRole"],
    });

    const parentSMInvokeFunction = new NodejsFunction(
      this,
      name(buildConfig, `parentSMInvokeFunction`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
        architecture: Architecture.ARM_64,
        functionName: name(buildConfig, `parentSMInvokeFunction`),
        layers: [deployImportArtefacts.nodeJsLayer],
        entry: join(
          __dirname,
          "../../../",
          "lib",
          "lambda-functions",
          "current-config-handlers",
          "src",
          "trigger-parentSM.ts"
        ),
        bundling: {
          externalModules: [
            "@aws-sdk/client-sfn",
            "@aws-sdk/credential-providers",
            "uuid",
          ],
          minify: true,
          environment: {
            functionLogMode: buildConfig.Parameters.FunctionLogMode,
          },
        },
      }
    );

    if (parentSMInvokeFunction.role) {
      parentSMInvokeFunction.role.addToPrincipalPolicy(parentSMInvokePolicy);
    }

    const parentSMInvokeProvider = new Provider(
      this,
      name(buildConfig, "parentSMInvokeProvider"),
      {
        onEventHandler: parentSMInvokeFunction,
        isCompleteHandler: updateCustomResourceHandler,
        queryInterval: Duration.seconds(5),
        totalTimeout: Duration.minutes(120), // to handle scenarios where organisations have a lot of existing account assignments already
      }
    );

    const parentSMResource = new CustomResource(
      this,
      name(buildConfig, "parentSMResource"),
      {
        serviceToken: parentSMInvokeProvider.serviceToken,
        properties: {
          smInvokeRoleArn: deployImportArtefacts.currentConfigSMInvokeRoleArn,
          importCurrentConfigSMArn: `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-importCurrentConfigSM`,
          importAccountAssignmentSMArn: `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-importAccountAssignmentSM`,
          importPermissionSetSMArn: `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-importPermissionSetSM`,
          accountAssignmentImportTopicArn:
            deployImportArtefacts.accountAssignmentImportTopic.topicArn,
          permissionSetImportTopicArn:
            deployImportArtefacts.permissionSetImportTopic.topicArn,
          importCmpAndPbArn: deployImportArtefacts.importCmpAndPbFunctionArn,
          temporaryPermissionSetTableName: `${buildConfig.Environment}-temp-PermissionSets`,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          functionLogMode: buildConfig.Parameters.FunctionLogMode,
        },
      }
    );

    parentSMResource.node.addDependency(importAccountAssignmentHandler);
    parentSMResource.node.addDependency(importPermissionSetHandler);
    parentSMResource.node.addDependency(updateCustomResourceHandler);
  }
}

import { CustomResource, Duration, Stack, StackProps } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../../build/buildConfig";
import { SSOObjectsDiscoveryPart2 } from "../../constructs/sso-objects-discovery-part2";

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

    /**
     * We deploy SSO objects discovery part 2 for both nightly run and import
     * current config use cases
     */

    const deploySSOObjectsDiscoveryPart2 = new SSOObjectsDiscoveryPart2(
      this,
      name(buildConfig, `importAccountAssignmentHandler`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
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
    /** Use case specific additions */

    /**
     * If import current config is enabled, we want to trigger the state machine
     * as part of the pipeline deployment using CloudFormation Custom Resource
     * CDK framework
     */

    if (buildConfig.Parameters.ImportCurrentSSOConfiguration === true) {
      const updateCustomResourceHandler = new NodejsFunction(
        this,
        name(buildConfig, `updateCustomResourceHandler`),
        {
          runtime: lambda.Runtime.NODEJS_16_X,
          functionName: name(buildConfig, `updateCustomResourceHandler`),
          layers: [deploySSOObjectsDiscoveryPart2.nodeJsLayer],
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
              deploySSOObjectsDiscoveryPart2.currentConfigSMDescribeRoleArn,
            ssoAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
            ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          },
        }
      );

    const importPermissionSetHandler = new NodejsFunction(
      this,
      name(buildConfig, `importPermissionSetHandler`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
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
        },
      }

      const parentSMInvokePolicy = new PolicyStatement({
        resources: [
          deploySSOObjectsDiscoveryPart2.currentConfigSMInvokeRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      });

      const parentSMInvokeFunction = new NodejsFunction(
        this,
        name(buildConfig, `parentSMInvokeFunction`),
        {
          runtime: lambda.Runtime.NODEJS_16_X,
          functionName: name(buildConfig, `parentSMInvokeFunction`),
          layers: [deploySSOObjectsDiscoveryPart2.nodeJsLayer],
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
          },
        }
      );

    const updateCustomResourceHandler = new NodejsFunction(
      this,
      name(buildConfig, `updateCustomResourceHandler`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
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
        },
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

    const parentSMInvokeFunction = new NodejsFunction(
      this,
      name(buildConfig, `parentSMInvokeFunction`),
      {
        runtime: lambda.Runtime.NODEJS_16_X,
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
        },
      }
    );

      parentSMResource.node.addDependency(
        deploySSOObjectsDiscoveryPart2.importAccountAssignmentHandler
      );
      parentSMResource.node.addDependency(
        deploySSOObjectsDiscoveryPart2.importPermissionSetHandler
      );
      parentSMResource.node.addDependency(updateCustomResourceHandler);
    }
  }
}

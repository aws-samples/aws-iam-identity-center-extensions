/*
composite construct that sets up all resources
for permission set CRUD operations and handles both API
and S3 interfaces
*/

import { CfnOutput, RemovalPolicy } from "aws-cdk-lib";
import { LambdaRestApi } from "aws-cdk-lib/aws-apigateway";
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
} from "aws-cdk-lib/aws-dynamodb";
import { Role } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Bucket, EventType } from "aws-cdk-lib/aws-s3";
import { LambdaDestination } from "aws-cdk-lib/aws-s3-notifications";
import { Topic } from "aws-cdk-lib/aws-sns";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";
import { LambdaProxyAPI } from "./lambda-proxy-api";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface PermissionSetCRUDProps {
  readonly nodeJsLayer: LayerVersion;
  readonly linksTableName: string;
  readonly errorNotificationsTopicArn: string;
  readonly ssoArtefactsBucket: Bucket;
  readonly ddbTablesKey: Key;
  readonly snsTopicsKey: Key;
  readonly logsKey: Key;
}

export class PermissionSetCRUD extends Construct {
  public readonly permissionSetTable: Table;
  public readonly permissionSetArnTable: Table;
  public readonly permissionSetAPIHandler: NodejsFunction;
  public readonly permissionSetAPI: LambdaRestApi;
  public readonly permissionSetCuHandler: NodejsFunction;
  public readonly permissionSetDelHandler: NodejsFunction;
  public readonly permissionSetProcessingTopic: Topic;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    PermissionSetCRUDProps: PermissionSetCRUDProps
  ) {
    super(scope, id);

    this.permissionSetProcessingTopic = new Topic(
      this,
      name(buildConfig, "permissionSetProcessingTopic"),
      {
        displayName: name(buildConfig, "permissionSetProcessingTopic"),
        masterKey: PermissionSetCRUDProps.snsTopicsKey,
      }
    );

    this.permissionSetTable = new Table(
      this,
      name(buildConfig, "permissionSetTable"),
      {
        partitionKey: {
          name: "permissionSetName",
          type: AttributeType.STRING,
        },
        tableName: name(buildConfig, "permissionSetTable"),
        billingMode: BillingMode.PAY_PER_REQUEST,
        encryption: TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: PermissionSetCRUDProps.ddbTablesKey,
        pointInTimeRecovery: true,
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    this.permissionSetArnTable = new Table(
      this,
      name(buildConfig, "permissionSetArnTable"),
      {
        partitionKey: {
          name: "permissionSetName",
          type: AttributeType.STRING,
        },
        tableName: name(buildConfig, "permissionSetArnTable"),
        billingMode: BillingMode.PAY_PER_REQUEST,
        encryption: TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: PermissionSetCRUDProps.ddbTablesKey,
        pointInTimeRecovery: true,
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    if (
      buildConfig.Parameters.PermissionSetProvisioningMode.toLowerCase() ===
      "api"
    ) {
      this.permissionSetAPIHandler = new NodejsFunction(
        this,
        name(buildConfig, "psApiHandler"),
        {
          functionName: name(buildConfig, "psApiHandler"),
          runtime: Runtime.NODEJS_16_X,
          entry: join(
            __dirname,
            "../",
            "lambda-functions",
            "user-interface-handlers",
            "src",
            "permissionSetApi.ts"
          ),
          bundling: {
            minify: true,
            externalModules: [
              "@aws-sdk/client-dynamodb",
              "@aws-sdk/client-s3",
              "@aws-sdk/client-sns",
              "@aws-sdk/lib-dynamodb",
              "ajv",
              "uuid",
              "fs",
              "path",
            ],
          },
          layers: [PermissionSetCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.permissionSetTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            linksTable: PermissionSetCRUDProps.linksTableName,
            artefactsBucketName:
              PermissionSetCRUDProps.ssoArtefactsBucket.bucketName,
            permissionSetProcessingTopicArn:
              this.permissionSetProcessingTopic.topicArn,
          },
        }
      );

      this.permissionSetAPI = new LambdaProxyAPI(
        this,
        name(buildConfig, "permissionSetAPI"),
        buildConfig,
        {
          apiCallerRoleArn: buildConfig.Parameters.PermissionSetCallerRoleArn,
          apiNameKey: "permissionSetApi",
          apiResourceName: "postPermissionSetData",
          methodtype: "POST",
          proxyfunction: this.permissionSetAPIHandler,
          apiEndPointReaderAccountID:
            buildConfig.PipelineSettings.DeploymentAccountId,
        }
      ).lambdaProxyAPI;
    } else {
      this.permissionSetCuHandler = new NodejsFunction(
        this,
        name(buildConfig, "psCuHandler"),
        {
          functionName: name(buildConfig, "psCuHandler"),
          runtime: Runtime.NODEJS_16_X,
          entry: join(
            __dirname,
            "../",
            "lambda-functions",
            "user-interface-handlers",
            "src",
            "permissionSetCu.ts"
          ),
          bundling: {
            minify: true,
            externalModules: [
              "@aws-sdk/client-dynamodb",
              "@aws-sdk/client-s3",
              "@aws-sdk/client-sns",
              "@aws-sdk/lib-dynamodb",
              "ajv",
              "uuid",
              "fs",
              "path",
            ],
          },
          layers: [PermissionSetCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.permissionSetTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            errorNotificationsTopicArn:
              PermissionSetCRUDProps.errorNotificationsTopicArn,
            permissionSetProcessingTopicArn:
              this.permissionSetProcessingTopic.topicArn,
          },
        }
      );

      PermissionSetCRUDProps.ssoArtefactsBucket.addEventNotification(
        EventType.OBJECT_CREATED,
        new LambdaDestination(this.permissionSetCuHandler),
        {
          prefix: "permission_sets/",
          suffix: ".json",
        }
      );

      const permissionSetCallerRole = Role.fromRoleArn(
        this,
        name(buildConfig, "importedLinkCallerRole"),
        buildConfig.Parameters.PermissionSetCallerRoleArn
      );

      PermissionSetCRUDProps.ssoArtefactsBucket.grantReadWrite(
        permissionSetCallerRole
      );

      PermissionSetCRUDProps.ssoArtefactsBucket.encryptionKey?.grantEncryptDecrypt(
        permissionSetCallerRole
      );

      this.permissionSetDelHandler = new NodejsFunction(
        this,
        name(buildConfig, "psDelHandler"),
        {
          functionName: name(buildConfig, "psDelHandler"),
          runtime: Runtime.NODEJS_16_X,
          entry: join(
            __dirname,
            "../",
            "lambda-functions",
            "user-interface-handlers",
            "src",
            "permissionSetDel.ts"
          ),
          bundling: {
            minify: true,
            externalModules: [
              "@aws-sdk/client-dynamodb",
              "@aws-sdk/client-sns",
              "@aws-sdk/lib-dynamodb",
              "ajv",
              "uuid",
            ],
          },
          layers: [PermissionSetCRUDProps.nodeJsLayer],
          environment: {
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            errorNotificationsTopicArn:
              PermissionSetCRUDProps.errorNotificationsTopicArn,
            linksTable: PermissionSetCRUDProps.linksTableName,
            permissionSetProcessingTopicArn:
              this.permissionSetProcessingTopic.topicArn,
          },
        }
      );

      PermissionSetCRUDProps.ssoArtefactsBucket.addEventNotification(
        EventType.OBJECT_REMOVED,
        new LambdaDestination(this.permissionSetDelHandler),
        {
          prefix: "permission_sets/",
          suffix: ".json",
        }
      );

      new CfnOutput(this, name(buildConfig, "permission-sets-location"), {
        exportName: name(buildConfig, "permission-sets-location"),
        value: `s3://${PermissionSetCRUDProps.ssoArtefactsBucket.bucketName}/permission_sets/`,
      });
    }

    new StringParameter(this, name(buildConfig, "permissionSetTableArn"), {
      parameterName: name(buildConfig, "permissionSetTableArn"),
      stringValue: this.permissionSetTable.tableArn,
    });

    new StringParameter(
      this,
      name(buildConfig, "permissionSetTableStreamArn"),
      {
        parameterName: name(buildConfig, "permissionSetTableStreamArn"),
        stringValue: this.permissionSetTable.tableStreamArn?.toString() + "",
      }
    );

    new StringParameter(this, name(buildConfig, "permissionSetArnTableArn"), {
      parameterName: name(buildConfig, "permissionSetArnTableArn"),
      stringValue: this.permissionSetArnTable.tableArn,
    });

    new StringParameter(
      this,
      name(buildConfig, "permissionSetProcessorTopicArn"),
      {
        parameterName: name(buildConfig, "permissionSetProcessorTopicArn"),
        stringValue: this.permissionSetProcessingTopic.topicArn,
      }
    );
  }
}

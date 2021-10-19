/*
composite construct that sets up all resources
for permission set CRUD operations and handles both API
and S3 interfaces
*/

import { LambdaRestApi } from "@aws-cdk/aws-apigateway";
import {
  AttributeType,
  BillingMode,
  StreamViewType,
  Table,
  TableEncryption,
} from "@aws-cdk/aws-dynamodb";
import { Role } from "@aws-cdk/aws-iam";
import { Key } from "@aws-cdk/aws-kms";
import * as lambda from "@aws-cdk/aws-lambda"; //Needed to avoid semgrep throwing up https://cwe.mitre.org/data/definitions/95.html
import { Bucket, EventType } from "@aws-cdk/aws-s3";
import { LambdaDestination } from "@aws-cdk/aws-s3-notifications";
import { CfnOutput, Construct, RemovalPolicy } from "@aws-cdk/core";
import * as Path from "path";
import { BuildConfig } from "../build/buildConfig";
import { LambdaProxyAPI } from "./lambda-proxy-api";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface PermissionSetCRUDProps {
  readonly nodeJsLayer: lambda.LayerVersion;
  readonly linksTableName: string;
  readonly errorNotificationsTopicArn: string;
  readonly ssoArtefactsBucket: Bucket;
  readonly ddbTablesKey: Key;
  readonly logsKey: Key;
}

export class PermissionSetCRUD extends Construct {
  public readonly permissionSetTable: Table;
  public readonly permissionSetArnTable: Table;
  public readonly permissionSetAPIHandler: lambda.Function;
  public readonly permissionSetAPI: LambdaRestApi;
  public readonly permissionSetCuHandler: lambda.Function;
  public readonly permissionSetDelHandler: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    PermissionSetCRUDProps: PermissionSetCRUDProps
  ) {
    super(scope, id);

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
        stream: StreamViewType.NEW_AND_OLD_IMAGES,
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
      this.permissionSetAPIHandler = new lambda.Function(
        this,
        name(buildConfig, "psApiHandler"),
        {
          runtime: lambda.Runtime.NODEJS_14_X,
          handler: "permissionSetApi.handler",
          functionName: name(buildConfig, "psApiHandler"),
          code: lambda.Code.fromAsset(
            Path.join(
              __dirname,
              "../",
              "lambda",
              "functions",
              "ddb-import-handlers"
            )
          ),
          layers: [PermissionSetCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.permissionSetTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            corsOrigin: buildConfig.Parameters.ApiCorsOrigin,
            linksTable: PermissionSetCRUDProps.linksTableName,
            artefactsBucketName:
              PermissionSetCRUDProps.ssoArtefactsBucket.bucketName,
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
      this.permissionSetCuHandler = new lambda.Function(
        this,
        name(buildConfig, "psCuHandler"),
        {
          runtime: lambda.Runtime.NODEJS_14_X,
          handler: "permissionSetCu.handler",
          functionName: name(buildConfig, "psCuHandler"),
          code: lambda.Code.fromAsset(
            Path.join(
              __dirname,
              "../",
              "lambda",
              "functions",
              "ddb-import-handlers"
            )
          ),
          layers: [PermissionSetCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.permissionSetTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            errorNotificationsTopicArn:
              PermissionSetCRUDProps.errorNotificationsTopicArn,
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

      this.permissionSetDelHandler = new lambda.Function(
        this,
        name(buildConfig, "psDelHandler"),
        {
          runtime: lambda.Runtime.NODEJS_14_X,
          handler: "permissionSetDel.handler",
          functionName: name(buildConfig, "psDelHandler"),
          code: lambda.Code.fromAsset(
            Path.join(
              __dirname,
              "../",
              "lambda",
              "functions",
              "ddb-import-handlers"
            )
          ),
          layers: [PermissionSetCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.permissionSetTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            errorNotificationsTopicArn:
              PermissionSetCRUDProps.errorNotificationsTopicArn,
            linksTable: PermissionSetCRUDProps.linksTableName,
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
        exportName: "permission-sets-location",
        value: `s3://${PermissionSetCRUDProps.ssoArtefactsBucket.bucketName}/permission_sets/`,
      });
    }
  }
}

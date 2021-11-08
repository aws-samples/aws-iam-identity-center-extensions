/*
composite construct that sets up all resources
for links CRUD operations and handles both API
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
import { NodejsFunction } from "@aws-cdk/aws-lambda-nodejs";
import { Bucket, EventType } from "@aws-cdk/aws-s3";
import { LambdaDestination } from "@aws-cdk/aws-s3-notifications";
import { CfnOutput, Construct, RemovalPolicy } from "@aws-cdk/core";
import * as Path from "path";
import { BuildConfig } from "../build/buildConfig";
import { LambdaProxyAPI } from "./lambda-proxy-api";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface LinkCRUDProps {
  readonly nodeJsLayer: lambda.LayerVersion;
  readonly errorNotificationsTopicArn: string;
  readonly ssoArtefactsBucket: Bucket;
  readonly ddbTablesKey: Key;
  readonly logsKey: Key;
}

export class LinkCRUD extends Construct {
  public readonly provisionedLinksTable: Table;
  public readonly linksTable: Table;
  public readonly linkAPIHandler: lambda.Function;
  public readonly linkAPI: LambdaRestApi;
  public readonly linkCuHandler: lambda.Function;
  public readonly linkDelHandler: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    linkCRUDProps: LinkCRUDProps
  ) {
    super(scope, id);

    this.provisionedLinksTable = new Table(
      this,
      name(buildConfig, "provisionedLinksTable"),
      {
        partitionKey: {
          name: "parentLink",
          type: AttributeType.STRING,
        },
        tableName: name(buildConfig, "provisionedLinksTable"),
        billingMode: BillingMode.PAY_PER_REQUEST,
        encryption: TableEncryption.CUSTOMER_MANAGED,
        encryptionKey: linkCRUDProps.ddbTablesKey,
        pointInTimeRecovery: true,
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    this.provisionedLinksTable.addGlobalSecondaryIndex({
      indexName: "tagKeyLookUp",
      partitionKey: {
        name: "tagKeyLookUp",
        type: AttributeType.STRING,
      },
    });

    this.linksTable = new Table(this, name(buildConfig, "linksTable"), {
      partitionKey: {
        name: "awsEntityId",
        type: AttributeType.STRING,
      },
      tableName: name(buildConfig, "linksTable"),
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: linkCRUDProps.ddbTablesKey,
      stream: StreamViewType.NEW_AND_OLD_IMAGES,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.linksTable.addGlobalSecondaryIndex({
      indexName: "groupName",
      partitionKey: {
        name: "groupName",
        type: AttributeType.STRING,
      },
    });

    this.linksTable.addGlobalSecondaryIndex({
      indexName: "awsEntityData",
      partitionKey: {
        name: "awsEntityData",
        type: AttributeType.STRING,
      },
    });

    this.linksTable.addGlobalSecondaryIndex({
      indexName: "permissionSetName",
      partitionKey: {
        name: "permissionSetName",
        type: AttributeType.STRING,
      },
    });

    if (buildConfig.Parameters.LinksProvisioningMode.toLowerCase() === "api") {
      this.linkAPIHandler = new NodejsFunction(
        this,
        name(buildConfig, "linkApiHandler"),
        {
          runtime: lambda.Runtime.NODEJS_14_X,
          functionName: name(buildConfig, "linkApiHandler"),
          entry: Path.join(
            __dirname,
            "../",
            "lambda-functions",
            "ddb-import-handlers",
            "src",
            "linkApi.ts"
          ),
          bundling: {
            externalModules: [
              "@aws-sdk/client-dynamodb",
              "@aws-sdk/client-s3",
              "@aws-sdk/lib-dynamodb",
              "jsonschema",
              "ajv",
            ],
            minify: true,
          },
          layers: [linkCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.linksTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            corsOrigin: "'*'",
            artefactsBucketName: linkCRUDProps.ssoArtefactsBucket.bucketName,
          },
        }
      );

      this.linkAPI = new LambdaProxyAPI(
        this,
        name(buildConfig, "linkApi"),
        buildConfig,
        {
          apiCallerRoleArn: buildConfig.Parameters.LinkCallerRoleArn,
          apiNameKey: "linkApi",
          apiResourceName: "postLinkData",
          methodtype: "POST",
          proxyfunction: this.linkAPIHandler,
          apiEndPointReaderAccountID:
            buildConfig.PipelineSettings.DeploymentAccountId,
        }
      ).lambdaProxyAPI;
    } else {
      this.linkCuHandler = new lambda.Function(
        this,
        name(buildConfig, "linkCuHandler"),
        {
          runtime: lambda.Runtime.NODEJS_14_X,
          handler: "linkCu.handler",
          functionName: name(buildConfig, "linkCuHandler"),
          code: lambda.Code.fromAsset(
            Path.join(
              __dirname,
              "../",
              "lambda-functions",
              "ddb-import-handlers",
              "src"
            )
          ),
          layers: [linkCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.linksTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            errorNotificationsTopicArn:
              linkCRUDProps.errorNotificationsTopicArn,
          },
        }
      );

      linkCRUDProps.ssoArtefactsBucket.addEventNotification(
        EventType.OBJECT_CREATED,
        new LambdaDestination(this.linkCuHandler),
        {
          prefix: "links_data/",
          suffix: ".ssofile",
        }
      );

      this.linkDelHandler = new lambda.Function(
        this,
        name(buildConfig, "linkDelHandler"),
        {
          runtime: lambda.Runtime.NODEJS_14_X,
          handler: "permissionSetDel.handler",
          functionName: name(buildConfig, "linkDelHandler"),
          code: lambda.Code.fromAsset(
            Path.join(
              __dirname,
              "../",
              "lambda-functions",
              "ddb-import-handlers",
              "src"
            )
          ),
          layers: [linkCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.linksTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            errorNotificationsTopicArn:
              linkCRUDProps.errorNotificationsTopicArn,
          },
        }
      );

      linkCRUDProps.ssoArtefactsBucket.addEventNotification(
        EventType.OBJECT_REMOVED,
        new LambdaDestination(this.linkDelHandler),
        {
          prefix: "links_data/",
          suffix: ".ssofile",
        }
      );

      const linkCallerRole = Role.fromRoleArn(
        this,
        name(buildConfig, "importedLinkCallerRole"),
        buildConfig.Parameters.LinkCallerRoleArn
      );

      linkCRUDProps.ssoArtefactsBucket.grantReadWrite(linkCallerRole);
      linkCRUDProps.ssoArtefactsBucket.encryptionKey?.grantEncryptDecrypt(
        linkCallerRole
      );

      new CfnOutput(this, name(buildConfig, "links-data-location"), {
        exportName: name(buildConfig, "links-data-location"),
        value: `s3://${linkCRUDProps.ssoArtefactsBucket.bucketName}/links_data/`,
      });
    }
  }
}

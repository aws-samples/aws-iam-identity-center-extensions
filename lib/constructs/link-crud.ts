/**
 * Composite construct that sets up all resources for account assignment CRUD
 * operations and handles both API and S3 interfaces
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
import { name } from "./helpers";

export interface LinkCRUDProps {
  readonly nodeJsLayer: LayerVersion;
  readonly errorNotificationsTopicArn: string;
  readonly ssoArtefactsBucket: Bucket;
  readonly snsTopicsKey: Key;
  readonly ddbTablesKey: Key;
  readonly logsKey: Key;
}

export class LinkCRUD extends Construct {
  public readonly provisionedLinksTable: Table;
  public readonly linksTable: Table;
  public readonly linkAPIHandler: NodejsFunction;
  public readonly linkAPI: LambdaRestApi;
  public readonly linkCuHandler: NodejsFunction;
  public readonly linkDelHandler: NodejsFunction;
  public readonly linkProcessingTopic: Topic;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    linkCRUDProps: LinkCRUDProps,
  ) {
    super(scope, id);

    this.linkProcessingTopic = new Topic(
      this,
      name(buildConfig, "linkProcessingTopic"),
      {
        displayName: name(buildConfig, "linkProcessingTopic"),
        masterKey: linkCRUDProps.snsTopicsKey,
      },
    );

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
      },
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
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.linksTable.addGlobalSecondaryIndex({
      indexName: "principalName",
      partitionKey: {
        name: "principalName",
        type: AttributeType.STRING,
      },
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
          functionName: name(buildConfig, "linkApiHandler"),
          runtime: Runtime.NODEJS_20_X,
          entry: join(
            __dirname,
            "../",
            "lambda-functions",
            "user-interface-handlers",
            "src",
            "linkApi.ts",
          ),
          bundling: {
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
            minify: true,
          },
          layers: [linkCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.linksTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            artefactsBucketName: linkCRUDProps.ssoArtefactsBucket.bucketName,
            linkProcessingTopicArn: this.linkProcessingTopic.topicArn,
            functionLogMode: buildConfig.Parameters.FunctionLogMode,
          },
        },
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
        },
      ).lambdaProxyAPI;
    } else {
      this.linkCuHandler = new NodejsFunction(
        this,
        name(buildConfig, "linkCuHandler"),
        {
          functionName: name(buildConfig, "linkCuHandler"),
          runtime: Runtime.NODEJS_20_X,
          entry: join(
            __dirname,
            "../",
            "lambda-functions",
            "user-interface-handlers",
            "src",
            "linkCu.ts",
          ),
          bundling: {
            externalModules: [
              "@aws-sdk/client-dynamodb",
              "@aws-sdk/lib-dynamodb",
              "@aws-sdk/client-sns",
              "uuid",
              "ajv",
              "fs",
              "path",
            ],
            minify: true,
          },
          layers: [linkCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.linksTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            errorNotificationsTopicArn:
              linkCRUDProps.errorNotificationsTopicArn,
            linkProcessingTopicArn: this.linkProcessingTopic.topicArn,
            functionLogMode: buildConfig.Parameters.FunctionLogMode,
          },
        },
      );

      linkCRUDProps.ssoArtefactsBucket.addEventNotification(
        EventType.OBJECT_CREATED,
        new LambdaDestination(this.linkCuHandler),
        {
          prefix: "links_data/",
        },
      );

      this.linkDelHandler = new NodejsFunction(
        this,
        name(buildConfig, "linkDelHandler"),
        {
          functionName: name(buildConfig, "linkDelHandler"),
          runtime: Runtime.NODEJS_20_X,
          entry: join(
            __dirname,
            "../",
            "lambda-functions",
            "user-interface-handlers",
            "src",
            "linkDel.ts",
          ),
          bundling: {
            externalModules: [
              "@aws-sdk/client-dynamodb",
              "@aws-sdk/lib-dynamodb",
              "@aws-sdk/client-sns",
              "uuid",
              "ajv",
              "fs",
              "path",
            ],
            minify: true,
          },
          layers: [linkCRUDProps.nodeJsLayer],
          environment: {
            DdbTable: this.linksTable.tableName,
            AWS_NODEJS_CONNECTION_REUSE_ENABLED: "1",
            errorNotificationsTopicArn:
              linkCRUDProps.errorNotificationsTopicArn,
            linkProcessingTopicArn: this.linkProcessingTopic.topicArn,
            functionLogMode: buildConfig.Parameters.FunctionLogMode,
          },
        },
      );

      linkCRUDProps.ssoArtefactsBucket.addEventNotification(
        EventType.OBJECT_REMOVED,
        new LambdaDestination(this.linkDelHandler),
        {
          prefix: "links_data/",
        },
      );

      const linkCallerRole = Role.fromRoleArn(
        this,
        name(buildConfig, "importedLinkCallerRole"),
        buildConfig.Parameters.LinkCallerRoleArn,
      );

      linkCRUDProps.ssoArtefactsBucket.grantReadWrite(linkCallerRole);
      linkCRUDProps.ssoArtefactsBucket.encryptionKey?.grantEncryptDecrypt(
        linkCallerRole,
      );

      new CfnOutput(this, name(buildConfig, "links-data-location"), {
        exportName: name(buildConfig, "account-assignments-location"),
        value: `s3://${linkCRUDProps.ssoArtefactsBucket.bucketName}/links_data/`,
      });
    }
    new StringParameter(this, name(buildConfig, "linksTableArn"), {
      parameterName: name(buildConfig, "linksTableArn"),
      stringValue: this.linksTable.tableArn,
    });

    new StringParameter(this, name(buildConfig, "linksTableStreamArn"), {
      parameterName: name(buildConfig, "linksTableStreamArn"),
      stringValue: this.linksTable.tableStreamArn?.toString() + "",
    });

    new StringParameter(this, name(buildConfig, "provisionedLinksTableArn"), {
      parameterName: name(buildConfig, "provisionedLinksTableArn"),
      stringValue: this.provisionedLinksTable.tableArn,
    });

    new StringParameter(this, name(buildConfig, "linkProcessorTopicArn"), {
      parameterName: name(buildConfig, "linkProcessorTopicArn"),
      stringValue: this.linkProcessingTopic.topicArn,
    });
  }
}

/*
composite construct that sets up all resources
for SSO group import event notifications
*/

import { RemovalPolicy } from "aws-cdk-lib";
import {
  AttributeType,
  BillingMode,
  Table,
  TableEncryption,
} from "aws-cdk-lib/aws-dynamodb";
import { IKey } from "aws-cdk-lib/aws-kms"; // Importing external resources in CDK would use interfaces and not base objects
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface SSOGroupCrudProps {
  readonly ddbTablesKey: IKey;
}

export class SSOGroupCRUD extends Construct {
  public readonly groupsTable: Table;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    ssoGroupCrudProps: SSOGroupCrudProps
  ) {
    super(scope, id);

    this.groupsTable = new Table(this, name(buildConfig, "groupsTable"), {
      partitionKey: {
        name: "groupId",
        type: AttributeType.STRING,
      },
      tableName: name(buildConfig, "groupsTable"),
      billingMode: BillingMode.PAY_PER_REQUEST,
      encryption: TableEncryption.CUSTOMER_MANAGED,
      encryptionKey: ssoGroupCrudProps.ddbTablesKey,
      pointInTimeRecovery: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.groupsTable.addGlobalSecondaryIndex({
      indexName: "groupName",
      partitionKey: {
        name: "groupName",
        type: AttributeType.STRING,
      },
    });
  }
}

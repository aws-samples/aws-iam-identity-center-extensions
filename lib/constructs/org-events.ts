/** Composite construct that sets up all resources for org events handling */

import { Duration } from "aws-cdk-lib";
import { ILayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { SnsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { ITopic } from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";
import { name } from "./helpers";

export interface OrgEventsProps {
  readonly linksTableName: string;
  readonly permissionSetArnTableName: string;
  readonly linkQueueUrl: string;
  readonly errorNotificationsTopicArn: string;
  readonly nodeJsLayer: ILayerVersion;
  readonly orgEventsNotificationTopic: ITopic;
  readonly listInstancesSSOAPIRoleArn: string;
  readonly listGroupsIdentityStoreAPIRoleArn: string;
  readonly provisionedlinksTableName: string;
  readonly orgListParentsRoleArn: string;
}

export class OrgEvents extends Construct {
  public readonly orgEventsHandler: NodejsFunction;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    orgEventsProps: OrgEventsProps
  ) {
    super(scope, id);

    this.orgEventsHandler = new NodejsFunction(
      this,
      name(buildConfig, "orgEventsHandler"),
      {
        runtime: Runtime.NODEJS_16_X,
        functionName: name(buildConfig, "orgEventsHandler"),
        entry: join(
          __dirname,
          "../",
          "lambda-functions",
          "application-handlers",
          "src",
          "orgEvents.ts"
        ),
        bundling: {
          externalModules: [
            "@aws-sdk/client-sns",
            "@aws-sdk/client-dynamodb",
            "@aws-sdk/client-identitystore",
            "@aws-sdk/client-sso-admin",
            "@aws-sdk/credential-providers",
            "@aws-sdk/lib-dynamodb",
            "@aws-sdk/client-organizations",
            "@aws-sdk/client-sqs",
            "uuid",
          ],
          minify: true,
        },
        layers: [orgEventsProps.nodeJsLayer],
        environment: {
          linkQueueUrl: orgEventsProps.linkQueueUrl,
          permissionSetArnTable: orgEventsProps.permissionSetArnTableName,
          DdbTable: orgEventsProps.linksTableName,
          errorNotificationsTopicArn: orgEventsProps.errorNotificationsTopicArn,
          adUsed: String(buildConfig.Parameters.IsAdUsed),
          domainName: buildConfig.Parameters.DomainName,
          SSOAPIRoleArn: orgEventsProps.listInstancesSSOAPIRoleArn,
          ISAPIRoleArn: orgEventsProps.listGroupsIdentityStoreAPIRoleArn,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          provisionedLinksTable: orgEventsProps.provisionedlinksTableName,
          supportNestedOU: String(buildConfig.Parameters.SupportNestedOU),
          orgListParentsRoleArn: orgEventsProps.orgListParentsRoleArn,
        },
        timeout: Duration.minutes(5), //aggressive timeout to accommodate for child OU's having many parents
      }
    );

    this.orgEventsHandler.addEventSource(
      new SnsEventSource(orgEventsProps.orgEventsNotificationTopic)
    );
  }
}

/*
composite construct that sets up all resources
for org events handling
*/

import * as lambda from "@aws-cdk/aws-lambda"; //Needed to avoid semgrep throwing up https://cwe.mitre.org/data/definitions/95.html
import { SnsEventSource } from "@aws-cdk/aws-lambda-event-sources";
import { ITopic } from "@aws-cdk/aws-sns";
import { Construct } from "@aws-cdk/core";
import * as Path from "path";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export interface OrgEventsProps {
  readonly linksTableName: string;
  readonly permissionSetArnTableName: string;
  readonly groupsTableName: string;
  readonly linkManagerTopicArn: string;
  readonly errorNotificationsTopicArn: string;
  readonly nodeJsLayer: lambda.LayerVersion;
  readonly orgEventsNotificationTopic: ITopic;
  readonly listInstancesSSOAPIRoleArn: string;
  readonly listGroupsIdentityStoreAPIRoleArn: string;
  readonly provisionedlinksTableName: string;
}

export class OrgEvents extends Construct {
  public readonly orgEventsHandler: lambda.Function;

  constructor(
    scope: Construct,
    id: string,
    buildConfig: BuildConfig,
    orgEventsProps: OrgEventsProps
  ) {
    super(scope, id);

    this.orgEventsHandler = new lambda.Function(
      this,
      name(buildConfig, "orgEventsHandler"),
      {
        runtime: lambda.Runtime.NODEJS_14_X,
        handler: "orgEvents.handler",
        functionName: name(buildConfig, "orgEventsHandler"),
        code: lambda.Code.fromAsset(
          Path.join(__dirname, "../", "lambda", "functions", "sso-handlers")
        ),
        layers: [orgEventsProps.nodeJsLayer],
        environment: {
          topicArn: orgEventsProps.linkManagerTopicArn,
          groupsTable: orgEventsProps.groupsTableName,
          permissionSetArnTable: orgEventsProps.permissionSetArnTableName,
          DdbTable: orgEventsProps.linksTableName,
          errorNotificationsTopicArn: orgEventsProps.errorNotificationsTopicArn,
          adUsed: String(buildConfig.Parameters.IsAdUsed),
          domainName: buildConfig.Parameters.DomainName,
          SSOAPIRoleArn: orgEventsProps.listInstancesSSOAPIRoleArn,
          ISAPIRoleArn: orgEventsProps.listGroupsIdentityStoreAPIRoleArn,
          ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          provisionedLinksTable: orgEventsProps.provisionedlinksTableName,
        },
      }
    );

    this.orgEventsHandler.addEventSource(
      new SnsEventSource(orgEventsProps.orgEventsNotificationTopic)
    );
  }
}

/*
Construct that sets up all artefacts required for observability
*/

import { CfnQueryDefinition } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class ObservabilityArtefacts extends Construct {
  constructor(scope: Construct, id: string, buildConfig: BuildConfig) {
    super(scope, id);

    // All Cloud watch insights query

    // All lambda log group names
    const accountAssignmentAPILogGroupNames: Array<string> = [
      `/aws/lambda/${buildConfig.Environment}-linkApiHandler`,
      `/aws/lambda/${buildConfig.Environment}-linkManagerHandler`,
      `/aws/lambda/${buildConfig.Environment}-linkTopicProcessor`,
      `/aws/lambda/${buildConfig.Environment}-processTargetAccountSMListenerHandler`,
    ];

    const ssoGroupLogGroupNames: Array<string> = [
      `/aws/lambda/${buildConfig.Environment}-linkManagerHandler`,
      `/aws/lambda/${buildConfig.Environment}-processTargetAccountSMListenerHandler`,
      `/aws/lambda/${buildConfig.Environment}-ssoGroupHandler`,
    ];

    const permissionSetSyncLogGroupNames: Array<string> = [
      `/aws/lambda/${buildConfig.Environment}-linkManagerHandler`,
      `/aws/lambda/${buildConfig.Environment}-processTargetAccountSMListenerHandler`,
      `/aws/lambda/${buildConfig.Environment}-permissionSetSyncHandler`,
    ];

    const orgEventsLogGroupNames: Array<string> = [
      `/aws/lambda/${buildConfig.Environment}-linkManagerHandler`,
      `/aws/lambda/${buildConfig.Environment}-processTargetAccountSMListenerHandler`,
      `/aws/lambda/${buildConfig.Environment}-orgEventsHandler`,
    ];

    //Get RequestDetails for accountAssignmentAPI flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "accountAssignmentAPIFlows-getRequestDetails"),
      {
        name: name(buildConfig, "accountAssignmentAPIFlows-getRequestDetails"),
        queryString:
          "filter requestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: accountAssignmentAPILogGroupNames,
      }
    );

    //Get Related RequestDetails for accountAssignmentAPI flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "accountAssignmentAPIFlows-getRelateedRequestDetails"),
      {
        name: name(
          buildConfig,
          "accountAssignmentAPIFlows-getRelateedRequestDetails"
        ),
        queryString:
          "filter sourceRequestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: accountAssignmentAPILogGroupNames,
      }
    );

    //Get RequestDetails for SSO group trigger flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "ssoGroupTriggerFlows-getRequestDetails"),
      {
        name: name(buildConfig, "ssoGroupTriggerFlows-getRequestDetails"),
        queryString:
          "fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp desc | limit 30",
        logGroupNames: ssoGroupLogGroupNames,
      }
    );

    //Get Related RequestDetails for SSO group trigger flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "ssoGroupTriggerFlows-getRelateedRequestDetails"),
      {
        name: name(
          buildConfig,
          "ssoGroupTriggerFlows-getRelateedRequestDetails"
        ),
        queryString:
          "filter sourceRequestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: ssoGroupLogGroupNames,
      }
    );

    //Get RequestDetails for permission set sync trigger flow
    new CfnQueryDefinition(
      this,
      name(buildConfig, "permissionSetSyncTriggerFlows-getRequestDetails"),
      {
        name: name(
          buildConfig,
          "permissionSetSyncTriggerFlows-getRequestDetails"
        ),
        queryString:
          "fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp desc | limit 30",
        logGroupNames: permissionSetSyncLogGroupNames,
      }
    );

    //Get Related RequestDetails for permission set sync trigger flows
    new CfnQueryDefinition(
      this,
      name(
        buildConfig,
        "permissionSetSyncTriggerFlows-getRelateedRequestDetails"
      ),
      {
        name: name(
          buildConfig,
          "permissionSetSyncTriggerFlows-getRelateedRequestDetails"
        ),
        queryString:
          "filter sourceRequestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: permissionSetSyncLogGroupNames,
      }
    );

    //Get RequestDetails for org events trigger flow
    new CfnQueryDefinition(
      this,
      name(buildConfig, "orgEventsTriggerFlows-getRequestDetails"),
      {
        name: name(buildConfig, "orgEventsTriggerFlows-getRequestDetails"),
        queryString:
          "fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp desc | limit 30",
        logGroupNames: orgEventsLogGroupNames,
      }
    );

    //Get Related RequestDetails for org events trigger flows
    new CfnQueryDefinition(
      this,
      name(buildConfig, "orgEventsTriggerFlows-getRelateedRequestDetails"),
      {
        name: name(
          buildConfig,
          "orgEventsTriggerFlows-getRelateedRequestDetails"
        ),
        queryString:
          "filter sourceRequestId like '' | fields requestId, handler, relatedData, status, statusMessage, relatedData, hasRelatedRequests, sourceRequestId | sort @timestamp asc",
        logGroupNames: orgEventsLogGroupNames,
      }
    );
  }
}

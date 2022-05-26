/*
This is used for any post clean up operations required
*/
import { Stack, StackProps } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { v4 as uuidv4 } from "uuid";
import { BuildConfig } from "../../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

const generateRandomString = uuidv4().toString().split("-")[0];

export class SSOImportArtefactsPart3 extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    /** Nightly run post clean up operations */
    if (buildConfig.Parameters.EnableNightlyRun === true) {
      /**
       * Enable nightlyRun rule to trigger the logic, as the import lambda's are
       * already created We use non deterministic physicalResourceId to
       * guarantee that the nightly run enablement is idempotent
       */
      const enablenightlyRunPolicyStatement = new PolicyStatement({
        resources: [
          `arn:aws:events:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:rule/${buildConfig.Environment}-nightlyRunRule`,
        ],
        actions: ["events:EnableRule"],
      });

      new AwsCustomResource(this, name(buildConfig, "enableNightlyRunRule"), {
        onCreate: {
          service: "EventBridge",
          action: "enableRule",
          parameters: {
            Name: name(buildConfig, "nightlyRunRule"),
          },
          physicalResourceId: PhysicalResourceId.of(generateRandomString),
          region: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        },
        policy: AwsCustomResourcePolicy.fromStatements([
          enablenightlyRunPolicyStatement,
        ]),
      });
    }
  }
}

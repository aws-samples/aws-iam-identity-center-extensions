/** Main pipeline stack i.e. entry point of the application */

import { Stack, StackProps, Tags } from "aws-cdk-lib";
import { Repository } from "aws-cdk-lib/aws-codecommit";
import {
  CodePipeline,
  CodePipelineSource,
  IFileSetProducer,
  ShellStep,
} from "aws-cdk-lib/pipelines";
import { Construct } from "constructs";
import { BuildConfig } from "../../build/buildConfig";
import {
  OrgArtefactsDeploymentStage,
  SolutionArtefactsDeploymentStage,
  SSOArtefactsDeploymentStage,
} from "./pipeline-stages";

function fullname(buildConfig: BuildConfig, name: string): string {
  return buildConfig.Environment + "-" + buildConfig.App + "-" + name;
}

export class AwsSsoExtensionsForEnterprise extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    /** Instantiate this to empty file set producer initially */
    let inputSource: IFileSetProducer = {};
    /**
     * Based on the pipeline source type, instantiate the source connection
     * appropriately
     */
    if (buildConfig.PipelineSettings.RepoType.toLowerCase() === "codecommit") {
      inputSource = CodePipelineSource.codeCommit(
        Repository.fromRepositoryArn(
          this,
          fullname(buildConfig, "importedCodeCommitRepo"),
          buildConfig.PipelineSettings.RepoArn
        ),
        buildConfig.PipelineSettings.RepoBranchName
      );
    } else if (
      buildConfig.PipelineSettings.RepoType.toLowerCase() === "codestar"
    ) {
      inputSource = CodePipelineSource.connection(
        buildConfig.PipelineSettings.RepoName,
        buildConfig.PipelineSettings.RepoBranchName,
        {
          connectionArn: buildConfig.PipelineSettings.CodeStarConnectionArn,
        }
      );
    }
    const pipeline = new CodePipeline(this, fullname(buildConfig, "pipeline"), {
      pipelineName: fullname(buildConfig, "pipeline"),
      crossAccountKeys: true,
      publishAssetsInParallel: false,
      synth: new ShellStep(fullname(buildConfig, "synth"), {
        input: inputSource,
        commands: [
          "yarn global add aws-cdk@2.x", //Because CodeBuild standard 5.0 does not yet have AWS CDK monorepo as default CDK package
          "mkdir ./lib/lambda-layers/nodejs-layer/nodejs/payload-schema-definitions",
          "cp -R ./lib/payload-schema-definitions/* ./lib/lambda-layers/nodejs-layer/nodejs/payload-schema-definitions/",
          "yarn --cwd ./lib/lambda-layers/nodejs-layer/nodejs install --frozen-lockfile --silent",
          "yarn --cwd ./lib/lambda-functions install --frozen-lockfile --silent",
          "yarn install --frozen-lockfile --silent",
          "yarn build",
          buildConfig.PipelineSettings.SynthCommand,
        ],
      }),
    });

    const deployOrgArtefacts = new OrgArtefactsDeploymentStage(
      this,
      fullname(buildConfig, "deployOrgArtefacts"),
      {
        env: {
          account: buildConfig.PipelineSettings.OrgMainAccountId,
          region: "us-east-1",
        },
      },
      buildConfig
    );

    Tags.of(deployOrgArtefacts).add("App", buildConfig.App);
    Tags.of(deployOrgArtefacts).add("Environment", buildConfig.Environment);

    pipeline.addStage(deployOrgArtefacts);

    const deploySSOArtefacts = new SSOArtefactsDeploymentStage(
      this,
      fullname(buildConfig, "deploySSOArtefacts"),
      {
        env: {
          account: buildConfig.PipelineSettings.SSOServiceAccountId,
          region: buildConfig.PipelineSettings.SSOServiceAccountRegion,
        },
      },
      buildConfig
    );

    Tags.of(deploySSOArtefacts).add("App", buildConfig.App);
    Tags.of(deploySSOArtefacts).add("Environment", buildConfig.Environment);

    pipeline.addStage(deploySSOArtefacts);

    const deploySolutionArtefacts = new SolutionArtefactsDeploymentStage(
      this,
      fullname(buildConfig, "deploySolutionArtefacts"),
      {
        env: {
          account: buildConfig.PipelineSettings.TargetAccountId,
          region: buildConfig.PipelineSettings.TargetAccountRegion,
        },
      },
      buildConfig
    );

    Tags.of(deploySolutionArtefacts).add("App", buildConfig.App);
    Tags.of(deploySolutionArtefacts).add(
      "Environment",
      buildConfig.Environment
    );

    pipeline.addStage(deploySolutionArtefacts);
  }
}

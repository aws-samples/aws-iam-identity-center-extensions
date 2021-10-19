/*
Main pipeline stack i.e. entry point of the application
*/

import { Repository } from "@aws-cdk/aws-codecommit";
import { Construct, Stack, StackProps, Tags } from "@aws-cdk/core";
import {
  CodePipeline,
  CodePipelineSource,
  ShellStep,
} from "@aws-cdk/pipelines";
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

    const pipeline = new CodePipeline(this, fullname(buildConfig, "pipeline"), {
      pipelineName: fullname(buildConfig, "pipeline"),
      crossAccountKeys: true,
      synth: new ShellStep(fullname(buildConfig, "synth"), {
        input: CodePipelineSource.codeCommit(
          Repository.fromRepositoryArn(
            this,
            fullname(buildConfig, "importedRepo"),
            buildConfig.PipelineSettings.RepoArn
          ),
          buildConfig.PipelineSettings.RepoBranchName
        ),
        commands: [
          "yarn --cwd ./lib/lambda/layers/nodejs-layer/nodejs install --frozen-lockfile",
          "yarn --cwd ./lib/lambda/layers/nodejs-layer/nodes audit --production",
          "pip3 install safety",
          "safety check -r ./lib/lambda/layers/python-layer/requirements.txt",
          "pip3 install --target ./lib/lambda/layers/python-layer/python -r ./lib/lambda/layers/python-layer/requirements.txt",
          "yarn install --frozen-lockfile",
          "yarn audit --production",
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

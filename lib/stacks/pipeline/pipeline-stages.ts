/*
Pipeline stages abstraction
*/

import {
  Construct,
  DefaultStackSynthesizer,
  Stage,
  StageProps,
} from "@aws-cdk/core";
import { BuildConfig } from "../../build/buildConfig";
import { OrgEventsProcessor } from "../pipelineStageStacks/org-events-processor";
import { PreSolutionArtefacts } from "../pipelineStageStacks/pre-solution-artefacts";
import { SolutionArtefacts } from "../pipelineStageStacks/solution-artefacts";
import { SSOApiRoles } from "../pipelineStageStacks/sso-api-roles";
import { SSOEventsProcessor } from "../pipelineStageStacks/sso-events-processor";

function fullname(buildConfig: BuildConfig, name: string): string {
  return buildConfig.Environment + "-" + buildConfig.App + "-" + name;
}

export class OrgArtefactsDeploymentStage extends Stage {
  constructor(
    scope: Construct,
    id: string,
    props: StageProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    new OrgEventsProcessor(
      this,
      fullname(buildConfig, "orgEventsProcessorStack"),
      {
        stackName: fullname(buildConfig, "orgEventsProcessorStack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig
    );
  }
}

export class SSOArtefactsDeploymentStage extends Stage {
  constructor(
    scope: Construct,
    id: string,
    props: StageProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    new SSOEventsProcessor(
      this,
      fullname(buildConfig, "ssoEventsProcessorStack"),
      {
        stackName: fullname(buildConfig, "ssoEventsProcessorStack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig
    );

    new SSOApiRoles(
      this,
      fullname(buildConfig, "ssoAPIRolesstack"),
      {
        stackName: fullname(buildConfig, "ssoAPIRolesstack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig
    );
  }
}

export class SolutionArtefactsDeploymentStage extends Stage {
  constructor(
    scope: Construct,
    id: string,
    props: StageProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    const preSolutionArtefactsStack = new PreSolutionArtefacts(
      this,
      fullname(buildConfig, "preSolutionArtefactsStack"),
      {
        stackName: fullname(buildConfig, "preSolutionArtefactsStack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig
    );

    const solutionartefactsStack = new SolutionArtefacts(
      this,
      fullname(buildConfig, "solutionartefactsStack"),
      {
        stackName: fullname(buildConfig, "solutionartefactsStack"),
        synthesizer: new DefaultStackSynthesizer({
          qualifier: buildConfig.PipelineSettings.BootstrapQualifier,
        }),
      },
      buildConfig,
      {
        deployIndependentUtility:
          preSolutionArtefactsStack.deployIndependentUtility,
        deployLambdaLayers: preSolutionArtefactsStack.deployLambdaLayers,
        deployLinkCRUD: preSolutionArtefactsStack.deployLinkCRUD,
        deployUtility: preSolutionArtefactsStack.deployUtility,
        deployPermissionSetCRUD:
          preSolutionArtefactsStack.deployPermissionSetCRUD,
      }
    );

    solutionartefactsStack.node.addDependency(preSolutionArtefactsStack);
  }
}

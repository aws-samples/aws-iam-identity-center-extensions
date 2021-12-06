/*
Lambda layers construct
*/

import { Code, LayerVersion, Runtime } from "aws-cdk-lib/aws-lambda";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class LambdaLayers extends Construct {
  public readonly nodeJsLayer: LayerVersion;
  public readonly pythonLayer: LayerVersion;

  constructor(scope: Construct, id: string, buildConfig: BuildConfig) {
    super(scope, id);

    this.nodeJsLayer = new LayerVersion(
      this,
      name(buildConfig, "nodeJsLayer"),
      {
        code: Code.fromAsset(
          join(__dirname, "../", "lambda-layers", "nodejs-layer")
        ),
        compatibleRuntimes: [Runtime.NODEJS_14_X],
      }
    );

    this.pythonLayer = new LayerVersion(
      this,
      name(buildConfig, "pythonLayer"),
      {
        code: Code.fromAsset(
          join(__dirname, "../", "lambda-layers", "python-layer")
        ),
        compatibleRuntimes: [Runtime.PYTHON_3_8],
      }
    );
  }
}

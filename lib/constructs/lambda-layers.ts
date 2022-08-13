/** Lambda layers construct */

import {
  Architecture,
  Code,
  LayerVersion,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../build/buildConfig";
import { name } from "./helpers";

export class LambdaLayers extends Construct {
  public readonly nodeJsLayer: LayerVersion;

  constructor(scope: Construct, id: string, buildConfig: BuildConfig) {
    super(scope, id);

    this.nodeJsLayer = new LayerVersion(
      this,
      name(buildConfig, "nodeJsLayer"),
      {
        code: Code.fromAsset(
          join(__dirname, "../", "lambda-layers", "nodejs-layer")
        ),
        compatibleRuntimes: [Runtime.NODEJS_16_X],
        compatibleArchitectures: [Architecture.ARM_64],
      }
    );

    new StringParameter(this, name(buildConfig, "nodeJsLayerVersionArn"), {
      parameterName: name(buildConfig, "nodeJsLayerVersionArn"),
      stringValue: this.nodeJsLayer.layerVersionArn,
    });
  }
}

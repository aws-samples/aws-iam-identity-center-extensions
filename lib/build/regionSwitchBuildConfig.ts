/**
 * Build parameters inteface Used for validating configuration files at
 * synthesis time for correctness of data type and data ranges/values
 */

export interface RegionSwitchBuildConfig {
  readonly BootstrapQualifier: string /** CDK bootstrap qualifier */;
  readonly SSOServiceAccountId: string;
  readonly SSOServiceAccountRegion: string;
  readonly SSOServiceTargetAccountRegion: string;
}

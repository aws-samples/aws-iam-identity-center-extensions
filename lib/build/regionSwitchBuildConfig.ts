/*
Build parameters interface definition
To enable easier sharing between constructs and stacks as well as
synth and deploy validations
*/

export interface RegionSwitchBuildConfig {
  readonly BootstrapQualifier: string;
  readonly SSOServiceAccountId: string;
  readonly SSOServiceAccountRegion: string;
  readonly SSOServiceTargetAccountRegion: string;
}

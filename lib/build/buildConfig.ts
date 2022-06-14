/**
 * Build parameters inteface Used for validating configuration files at
 * synthesis time for correctness of data type and data ranges/values
 */
export interface BuildConfig {
  readonly App: string /** Used as prefix for resource and stack names */;
  readonly Environment: string /** Used as prefix for resource and stack names */;
  readonly Version: string /** Used for aligning with github version */;
  readonly PipelineSettings: PipelineSettings;
  readonly Parameters: Parameters;
}

/** Pipeline specific parameters */
export interface PipelineSettings {
  readonly BootstrapQualifier: string /** CDK bootstrap qualifier to deploy the solution */;
  readonly DeploymentAccountId: string;
  readonly DeploymentAccountRegion: string;
  readonly TargetAccountId: string;
  readonly TargetAccountRegion: string;
  readonly SSOServiceAccountId: string;
  readonly SSOServiceAccountRegion: string;
  readonly OrgMainAccountId: string;
  readonly RepoArn: string /** AWS CodeCommit source code repository ARN */;
  readonly RepoBranchName: string /** AWS CodeCommit source code repository branch */;
  readonly SynthCommand: string /** CDK synthesise command */;
}

/** Solution specific parameters */
export interface Parameters {
  readonly LinksProvisioningMode: string /** Account assignments provisioning mode - accepted values are one of ["api", "s3"] */;
  readonly PermissionSetProvisioningMode: string /** Permission set provisioning mode - accepted values are one of ["api", "s3"] */;
  readonly LinkCallerRoleArn: string;
  /**
   * IAM role arn created in target account with permissions to upload account
   * assignments to S3/API interfaces
   */
  readonly PermissionSetCallerRoleArn: string;
  /**
   * IAM role arn created in target account with permissions to upload
   * permission sets to S3/API interfaces
   */
  readonly NotificationEmail: string /** Notification email used by solution to send error notifications etc */;
  readonly AccountAssignmentVisibilityTimeoutHours: number /** Visibility timeout parameter , used for scaling the solution in large enterprises */;
  readonly IsAdUsed: boolean;
  readonly DomainName: string;
  readonly ImportCurrentSSOConfiguration: boolean;
  /**
   * Used as switch to do a one-time import of all AWS SSO account assignments
   * and permission sets into the solution
   */
  readonly UpgradeFromVersionLessThanV303: boolean;
  /**
   * Used as switch to do one-time format upgrade of all the account assignments
   * that the solution provisioned and persisted in DynamoDB
   */
  readonly SupportNestedOU: boolean;
  /**
   * Used as switch to determine whether OU traversal is parent level only (or)
   * full tree traversal
   */
}

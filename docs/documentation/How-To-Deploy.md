# How To Deploy

## Pre-requisites

- [AWS CDK](https://github.com/aws/aws-cdk) installed on your local machine
- [yarn package manager](https://yarnpkg.com/getting-started/install) installed on your local machine
- This solution requires the use of 3 AWS accounts:
  1. A deployment account (DEPLOYMENT) - An account to manage the SSO extentions code, where we will be deploying the source code repository and deployment pipeline.
  2. A main Organization account (ORGMAIN) - this is required for listening to organization level based event notifications. For the purposes of demonstration, we will also use this as the SSO account, to process SSO admin and identity store operations.
  3. Target account (TARGET) - Where the solution architecture is deployed.

![High level design](docs/images/aws-sso-extensions-for-enterprise-overview.png)

## Deployment Steps

### Step 0: Setup solution code

- Clone the solution code from the repository to your local machine.
- Create a new [AWS codecommit](https://aws.amazon.com/codecommit/) repository where the solution code would be maintained in your DEPLOYMENT account.

### Step 1: Install the dependencies

- At the root of the local project, run `yarn install --frozen-lockfile`.

### Step 2: Create execution roles

To allow execution of the solution , we need to create two roles in the TARGET account:

- LinkCallerRoleArn: IAM role arn in the `TARGET account` that should have permissions to perform link provisioning/de-provisioning
- PermissionSetCallerRoleArn: IAM role arn in the `target account` that should have permissions to perform permission set
<!-- TODO: Would be good to have example requirements for these for users to copy paste in -->

### Step 3: Update environment-specific configuration

- Update configuration file (`config/env.yaml` file) with the corresponding values:

  - App: You could choose to update the app name or retain the existing name as-is
  - Environment: Ensure this reflects the name of the file.
  - Under pipeline settings,
    - BootstrapQualifier: Should be a unique qualifier for this repo. If you do not yet have a CDK application that uses `znb859fds` as the bootstrap qualifier, use that value. Otherwise, update this to a unique value within the CDK environment(account + region)
    - DeploymentAccountId: deployment account ID
    - DeploymentAccountRegion: deployment account region (eg, eu-west-1)
    - TargetAccountId: target account ID
    - OrgMainAccountId: org main account ID
    - TargetAccountRegion: target account region (eg, eu-west-1)
    - SSOServiceAccountId: SSO service account ID (until the time SSO service supports delegated admin mode deployment, this would be the same as OrgMainAccountId)
    - SSOServiceAccountRegion: the main region of your SSO service deployment (same as org main region)
    - RepoArn: ARN of the code commit repo created in Step1
    - RepoBranchName: branch of the repo where the code would be committed to
    - SynthCommand: This is of the format `yarn cdk-synth-<your-environment-name>`
  - Under Parameters:
    - LinksProvisioningMode: Choose either `api` or `s3` as the provisioning interface for links
    - PermissionSetProvisioningMode: Choose either `api` or `s3` as the provisioning interface for permission sets
    - LinkCallerRoleArn: the ARN of the LinkCallerRoleArn role we created in step 2
    - PermissionSetCallerRoleArn: the ARN of the PermissionSetCallerRoleArn role we created in step 2provisioning/de-provisioning
    - ApiCorsOrigin: You can update this to your requirements, or leave as is.
    - NotificationEmail: The email address that should receive failure/error notifications
    - IsAdUsed: set this to `true` or `false` depending on whether your SSO configuration uses Active Directory as the identity store. For the purposes of the walk through demo, we can leave this as false.
    - DomainName: set this to the FQDN of your AD

### Step 4: Bootstrap your accounts

We need to prepare the accounts to have the prerequisite tools to set up the accounts. To do this, we need to deploy the bootstrap `cdk-bootstrap/bootstrap-template.yaml` template in each account

1.Using the DEPLOYMENT account credentials and DEPLOYMENT account region, run the following replacing the values for stack name and qualifier appropriately.

```bash
aws cloudformation create-stack --template-body file://bootstrap-template.yml \
--stack-name <your-deployment-bootstrap-stack-name> \
--capabilities CAPABILITY_NAMED_IAM \
--parameters ParameterKey=Qualifier,ParameterValue=<your-bootstrap-qualifier> \
ParameterKey=CloudFormationExecutionPolicies,ParameterValue=arn:aws:iam::aws:policy/AdministratorAccess
```

2.Using the ORGMAIN account credentials and `us-east-1` region, run the following replacing the values for stack name, qualifier and trusted account values appropriately.

```bash
aws cloudformation create-stack --template-body file://bootstrap-template.yml \
--stack-name <your-orgmain-bootstrap-stack-name> \
--capabilities CAPABILITY_NAMED_IAM \
--parameters ParameterKey=Qualifier,ParameterValue=<your-bootstrap-qualifier> \
ParameterKey=CloudFormationExecutionPolicies,ParameterValue=arn:aws:iam::aws:policy/AdministratorAccess \
ParameterKey=TrustedAccounts,ParameterValue=<your-deployment-account-no>
```

3.Using the TARGET account credentials and TARGET account region, run the following replacing the values for stack name, qualifier and trusted account values appropriately.

```bash
aws cloudformation create-stack --template-body file://bootstrap-template.yml \
--stack-name <your-ssoaccount-bootstrap-stack-name> \
--capabilities CAPABILITY_NAMED_IAM \
--parameters ParameterKey=Qualifier,ParameterValue=<your-bootstrap-qualifier> \
ParameterKey=CloudFormationExecutionPolicies,ParameterValue=arn:aws:iam::aws:policy/AdministratorAccess \
ParameterKey=TrustedAccounts,ParameterValue=<your-deployment-account-no>
```

### Step 5: Run CDK Synth

- At the root of the project, run `yarn cdk-synth-env`. Ensure that the synth completes successfully.

### Step 7: Push source code to CodeCommit

- Push the changes to the codecommit repo created in Step 1.

### Step 8: Deploy the Pipeline stack

This stack can be deployed by running `yarn cdk-deploy-env`. Once the initial pipeline is created all further changes can be done by `git push` and the changes will be handled by the pipeline.

### Step 9: Subscribe to the SNS topic

After the pipeline has been successfully deployed, you will get an email asking to subscribe to the SNS topic at the address you provided in your config file. You need to subscribe to this topic to be able to receive error notifications.

# How To Deploy

## Pre-requisites

- [AWS CDK](https://github.com/aws/aws-cdk) installed on your local machine
- [yarn package manager](https://yarnpkg.com/getting-started/install) installed on your local machine
- This solution requires the use of 3 AWS accounts:

  1. A deployment account (DEPLOYMENT) - An account to manage the SSO extensions code, where we will be deploying the source code repository and deployment pipeline.
  2. A main Organization account (ORGMAIN) - this is required for listening to organization level based event notifications. For the purposes of demonstration, we will also use this as the SSO account, to process SSO admin and identity store operations.

     **NOTE**

     Currently, AWS SSO service can only be configured in the ORGMAIN account for the entire organization. However, the solution is built with the assumption that AWS SSO service would support a delegated administrator model, similar to GuardDuty and other services. When this feature is supported by the solution at a later time, the only change required is the configuration file update to reflect the new account and region for SSO service and CDK bootstrapping in that new account and region. The solution does not need to be re-deployed.

  3. Target account (TARGET) - Where the solution architecture is deployed.
  4. The solution assumes that CloudTrail is enabled in ORGMAIN account and SSO account as this would be required by the solution.

See the [High level design](../images/aws-sso-extensions-for-enterprise-overview.png) of the whole solution before deployment.

## Deployment Steps

### Step 0: Setup solution code

- Clone the solution code from this repository to your local machine.
- Create a new [AWS codecommit](https://aws.amazon.com/codecommit/) repository where the solution code would be maintained in your DEPLOYMENT account.

### Step 1: Install the dependencies

At the root of the local project, run:

```bash
yarn install --frozen-lockfile
```

### Step 2: Create execution roles

To allow execution of the solution, we need to create two roles in the TARGET account. These roles are assigned the required permissions by the solution, so empty roles with no permissions are sufficient to deploy the solution.

- LinkCallerRoleArn: IAM role arn in the `TARGET account` that would be granted permissions by the solution to perform link provisioning/de-provisioning
- PermissionSetCallerRoleArn: IAM role arn in the `TARGET account` that would be granted permissions by the solution to perform permission set provisioning/de-provisioning

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
    - SSOServiceAccountRegion: the main region of your SSO service deployment
    - RepoArn: ARN of the code commit repo created in Step 1
    - RepoBranchName: Branch of the repo where the code will be committed to
    - SynthCommand: The CDK synth command, of the format `yarn cdk-synth-<your-environment-name>`
  - Under Parameters:
    - LinksProvisioningMode: Choose either `api` or `s3` as the provisioning interface for links, depending on your use.
    - PermissionSetProvisioningMode: Choose either `api` or `s3` as the provisioning interface for the permission sets.
    - LinkCallerRoleArn: the ARN of the LinkCallerRoleArn role we created in step 2
    - PermissionSetCallerRoleArn: the ARN of the PermissionSetCallerRoleArn role we created in step 2
    - ApiCorsOrigin: You can update this to your requirements, or leave as is.
    - NotificationEmail: The email address that should receive failure/error notifications
    - IsAdUsed: set this to `true` or `false` depending on whether your SSO configuration uses Active Directory as the identity store. For the purposes of the walk through demo, we can leave this as false.
    - DomainName: set this to the FQDN of your AD

### Step 4: Bootstrap your accounts

We need to prepare the accounts to have the prerequisite tools to set up the accounts. To do this, we need to deploy the bootstrap `cdk-bootstrap/bootstrap-template.yaml` template in each account

First we want to set environment variables for our deployments. Make sure the bootstrap qualifier is updated to the correct value if you changed it in Step 3. From the root of the project, run:

```bash
cd cdk-bootstrap
export BOOTSTRAP_QUALIFIER="znb859fds"
export DEPLOYMENT_ACCOUNT_NUMBER="<Your Deployment account ID>"
```

Ensure you have [AWS CLI credentials](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-files.html) loaded on your machine to the DEPLOYMENT, ORGMAIN and the TARGET accounts, with Admin rights to each.

Using the DEPLOYMENT account credentials and DEPLOYMENT account region, run the following:

```bash
aws cloudformation create-stack --template-body file://bootstrap-template.yml \
--stack-name deployment-bootstrap-stack \
--capabilities CAPABILITY_NAMED_IAM \
--parameters ParameterKey=Qualifier,ParameterValue=$BOOTSTRAP_QUALIFIER \
ParameterKey=CloudFormationExecutionPolicies,ParameterValue=arn:aws:iam::aws:policy/AdministratorAccess
```

Using the ORGMAIN account credentials and `us-east-1` region, run the following replacing the values for stack name, qualifier and trusted account values appropriately.

```bash
aws cloudformation create-stack --template-body file://bootstrap-template.yml \
--stack-name orgmain-bootstrap-stack \
--capabilities CAPABILITY_NAMED_IAM \
--parameters ParameterKey=Qualifier,ParameterValue=$BOOTSTRAP_QUALIFIER \
ParameterKey=CloudFormationExecutionPolicies,ParameterValue=arn:aws:iam::aws:policy/AdministratorAccess \
ParameterKey=TrustedAccounts,ParameterValue=$DEPLOYMENT_ACCOUNT_NUMBER
```

Using the TARGET account credentials and TARGET account region, run the following replacing the values for stack name, qualifier and trusted account values appropriately.

```bash
aws cloudformation create-stack --template-body file://bootstrap-template.yml \
--stack-name target-bootstrap-stack \
--capabilities CAPABILITY_NAMED_IAM \
--parameters ParameterKey=Qualifier,ParameterValue=$BOOTSTRAP_QUALIFIER \
ParameterKey=CloudFormationExecutionPolicies,ParameterValue=arn:aws:iam::aws:policy/AdministratorAccess \
ParameterKey=TrustedAccounts,ParameterValue=$DEPLOYMENT_ACCOUNT_NUMBER
```

### Step 5: Run CDK Synth

At the root of the project, run

```bash
yarn cdk-synth-env
```

Ensure that the [synth](https://docs.aws.amazon.com/cdk/latest/guide/hello_world.html#hello_world_tutorial_synth) completes successfully, and prints the compiled CloudFormation Template without errors.

### Step 7: Push source code to CodeCommit

Run cleanup, prior to committing the changes by running the below without any errors

```bash
yarn prettier && yarn eslint . --fix
```

[Push the changes](https://docs.aws.amazon.com/codecommit/latest/userguide/getting-started.html#getting-started-init-repo) to the codecommit repo in the DEPLOYMENT account created in Step 0.

### Step 8: Deploy the Pipeline stack

This stack can be deployed by running the following in the root of the project with DEPLOYMENT account credentials:

```bash
yarn cdk-deploy-env
```

Once the initial pipeline is created all further changes can be done by `git push` and the changes will be handled by the pipeline.

You can follow the status of the deployment of the pipeline stack in the [CloudFormation Console](https://us-east-1.console.aws.amazon.com/cloudformation)

### Step 9: Subscribe to the SNS topic

After the pipeline has been successfully deployed, you will get an email asking to subscribe to the SNS topic at the address you provided in your config file. You need to subscribe to this topic to be able to receive error notifications.

### NEXT: [Start Using](https://studio.us-east-1.prod.workshops.aws/preview/67ce7a7b-48aa-4b83-b9d4-98c3babbef8d/builds/67a01a15-d723-48bb-8412-5123efad201a/en-US/)

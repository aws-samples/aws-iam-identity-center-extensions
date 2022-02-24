# AWS SSO Region Switch

AWS SSO service is single-region at this point of time. In some instances, customers wish to move their AWS SSO configuration from one region to another region and this document explains how some of these migration activities could be automated.

## Caveats

- AWS SSO at this point of time does not have API's to manage identities , instance enablement. These are manual operations.
- When a customer migrates AWS SSO from one region to another region, the solution only helps automate migration of permission sets and account assignments.
- The solution assumes that identities (users/groups) are onboarded into the new region using the same naming convention. For ex, if a customer had onboarded a user with user name `alpha-user`, group with display name `beta-group` in region 1 through any of the supported identity sources, the solution assumes that the customer will onboard the user with the same user name `alpha-user` and same group display name `beta-group` in region 2. Only when this condition is met, the solution automatically migrates account assignments from region 1 to region 2.

## Seqence

- `Discover` component of the solution is deployed in your current AWS SSO account and current AWS SSO region first. This would read all the permission sets, account assignments in your current AWS SSO region and persist them for later usage
- The customer then manually moves the AWS SSO configuration from their current region to the new region
- The customer onboards all the required identities in the new region
- `Deploy` component of the solution is deployed in your current AWS SSO Account and new AWS SSO region. This would then deploy all the permission sets and account assignments similar to how they were provisioned in the old AWS SSO region.
- `Destroy` components of the solution are then run to remove the artefacts created in the `Discover` and `Deploy` phase.

## Execute

- Ensure the following [pre-requisites](https://catalog.us-east-1.prod.workshops.aws/workshops/640b0bab-1f5e-494a-973e-4ed7919d397b/en-US/00-prerequisites) are ready and available
- Clone the solution code

```bash
git clone https://github.com/aws-samples/aws-sso-extensions-for-enterprise.git solution-code
```

- From the root of the project run `yarn install --frozen-lock-file`
- Navigate to `lib\lambda-layers\nodejs-layer\nodejs` and run `yarn install --frozen-lock-file`
- Set the environment variables in your shell

```bash
export BOOTSTRAP_QUALIFIER="ssoutility"
export CFN_EXECUTION_POLICIES="arn:aws:iam::aws:policy/AdministratorAccess"
export CONFIG="region-switch-discover"
export SSO_PROFILE=<your-org-main-account-profile-name>
export SSO_ACCOUNT=<your-org-main-account-id>
export SSO_REGION=<your-sso-service-region>
```

- Using your org main (i.e. SSO service account) and current AWS SSO region credentials, run the following steps

```bash
yarn cdk bootstrap --qualifier $BOOTSTRAP_QUALIFIER \
--cloudformation-execution-policies $CFN_EXECUTION_POLICIES \
aws://$SSO_ACCOUNT/$SSO_REGION \
-c config=$CONFIG \
--profile $SSO_PROFILE \
--region $SSO_REGION
```

- Update your environment variables to match the new AWS SSO region

```bash
export CONFIG="region-switch-deploy"
export SSO_REGION=<your-new-sso-service-region>
```

- Using your org main (i.e. SSO service account) and new AWS SSO region credentials, run the following steps

```bash
yarn cdk bootstrap --qualifier $BOOTSTRAP_QUALIFIER \
--cloudformation-execution-policies $CFN_EXECUTION_POLICIES \
aws://$SSO_ACCOUNT/$SSO_REGION \
-c config=$CONFIG \
--profile $SSO_PROFILE \
--region $SSO_REGION
```

- Update `config\region-switch.yaml` file with your environment values

```yaml
BootstrapQualifier: "ssoutility"
SSOServiceAccountId: "<your-Org-main-account-id>"
SSOServiceAccountRegion: "<your-current-AWS-SSO-region"
SSOServiceTargetAccountRegion: "<your-new-AWS-SSO-region>"
```

- Run `Discover` phase through the following steps by using your Orgmain account and current AWS SSO region credentials:
- Validate that the configuration and other dependencies are all set up by running `yarn synth-region-switch-discover` from the root of the project.
- This should not return any errors and should synthesise successfully
- Run `deploy-region-switch-discover` from the root of the project. Wait until the discover phase Cloudformation stacks are successfully deployed.
- Set up AWS SSO in the new region, set up identity store and onboard all the identities in the new AWS SSO region, refer to service documentation [here](https://docs.aws.amazon.com/singlesignon/latest/userguide/getting-started.html).
- Identiies must be on-boarded into the new AWS SSO region before running the next step.
- Run `Deploy` phase through the following steps by using your Orgmain account and new AWS SSO region credentials:
- Validate that the configuration and other dependencies are all set up by running `yarn synth-region-switch-deploy` from the root of the project.
- This should not return any errors and should synthesise successfully
- Run `deploy-region-switch` from the root of the project. Wait until the deploy phase Cloudformation stacks are successfully deployed.
- Verify that all your account assignments and permission sets are successfully created in the new AWS SSO region
- Post verification that everything is deployed correctly in the new AWS SSO region, delete the artefacts created for `Deploy` and `Discover` phases by running the following:
- Using Orgmain and new AWS SSO region credentials, run `yarn destroy-region-switch-deploy` from the root of the project. This will remove all the deploy phase artefacts.
- Using Orgmain and old AWS SSO region credentials, run `yarn destroy-region-switch-discover` from the root of the project. This will remove all the discover phase artefacts

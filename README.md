# AWS SSO Extensions For Enterprise

![High level design](docs/images/aws-sso-extensions-for-enterprise-overview.png)

## Overview

`AWS SSO Extensions for Enterprise` simplifies the process to manage user
access to AWS accounts with [AWS SSO](https://aws.amazon.com/single-sign-on/) by extending the [AWS SSO API](https://docs.aws.amazon.com/singlesignon/latest/APIReference/welcome.html).

Instead of separately managing [AWS SSO permission sets](https://docs.aws.amazon.com/singlesignon/latest/userguide/permissionsetsconcept.html) and entitlement
links, you can use this solution to describe permission sets with one API call
per set. Like with permission sets, you can also define and
implement entitlement links at a global level, an organizational unit level or an account tag
level. The solution ensures your defined permissions are rolled out across
the entire AWS Organization, and that they are updated as you change your
organization.

This solution can be used by your identity and access management team to simplify user
access provisioning at scale, either via a RESTFul API or by defining and
setting objects with your permissions descriptions in an S3 bucket. This
enables you to integrate with upstream identity management systems you
have in your organization.

**[Get started with deployment!](docs/documentation/How-To-Deploy.md)**

## Features

### The Composite Permission Set API

This solution provides a composite API for managing permission set lifecycles, allowing you to:

- Create a complete permission set object including attributes and policies in a single call
- Update parts or all of a permission set object in a single call with a friendly name
- Delete a complete permission set in a single call with a friendly name
- Based on a configuration parameter, use either an S3 based interface or a RESTful API to upload permission set object as a whole
- Enforce the "cannot delete" constraint when a permission set is being referenced in an entitlement

<details>
<summary>Example payload to create a permission set</summary>
<p>

```json
{
  "action": "create",
  "permissionSetData": {
    "permissionSetName": "teamA-permissionSet",
    "sessionDurationInMinutes": "100",
    "relayState": "https://eu-west-1.console.aws.amazon.com/console/home?region=eu-central-1#",
    "tags": [
      {
        "Key": "versionid",
        "Value": "01"
      },
      {
        "Key": "team",
        "Value": "teamA"
      }
    ],
    "managedPoliciesArnList": [
      "arn:aws:iam::aws:policy/AmazonGlacierReadOnlyAccess"
    ],
    "inlinePolicyDocument": {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Condition": {
            "StringLike": {
              "iam:PermissionsBoundary": [
                "arn:aws:iam::121111112211:policy/boundaries/ApplicationFullAdmin-PermissionsBoundary"
              ]
            }
          },
          "Action": [
            "iam:PutRolePermissionsBoundary",
            "iam:CreateRole",
            "iam:PutRolePolicy",
            "iam:UpdateAssumeRolePolicy"
          ],
          "Resource": ["arn:aws:iam::*:role/Application_*"],
          "Effect": "Allow",
          "Sid": "AllowAttachPermBoundary"
        },
        {
          "Action": [
            "iam:AddRoleToInstanceProfile",
            "iam:CreateInstanceProfile",
            "iam:CreatePolicy"
          ],
          "Resource": [
            "arn:aws:iam::*:role/Application_*",
            "arn:aws:iam::*:policy/Application_*",
            "arn:aws:iam::*:instance-profile/Application_*"
          ],
          "Effect": "Allow",
          "Sid": "AllowOtherIAMActions"
        }
      ]
    }
  }
}
```

</p>
</details>

<details>
<summary>Example payload to update a permission set</summary>
<p>

```json
{
  "action": "update",
  "permissionSetData": {
    "permissionSetName": "teamA-permissionSet",
    "sessionDurationInMinutes": "360",
    "relayState": "https://eu-west-1.console.aws.amazon.com/console/home?region=eu-west-1#",
    "tags": [
      {
        "Key": "versionid",
        "Value": "02"
      },
      {
        "Key": "team",
        "Value": "teamA"
      }
    ],
    "managedPoliciesArnList": [
      "arn:aws:iam::aws:policy/AmazonGlacierReadOnlyAccess",
      "arn:aws:iam::aws:policy/AmazonRedshiftReadOnlyAccess"
    ],
    "inlinePolicyDocument": {
      "Version": "2012-10-17",
      "Statement": [
        {
          "Condition": {
            "StringLike": {
              "iam:PermissionsBoundary": [
                "arn:aws:iam::121111112211:policy/boundaries/ApplicationFullAdmin-PermissionsBoundary"
              ]
            }
          },
          "Action": [
            "iam:PutRolePermissionsBoundary",
            "iam:CreateRole",
            "iam:PutRolePolicy",
            "iam:UpdateAssumeRolePolicy"
          ],
          "Resource": ["arn:aws:iam::*:role/Application_*"],
          "Effect": "Allow",
          "Sid": "AllowAttachPermBoundary"
        },
        {
          "Action": [
            "iam:AddRoleToInstanceProfile",
            "iam:CreateInstanceProfile",
            "iam:CreatePolicy"
          ],
          "Resource": [
            "arn:aws:iam::*:role/Application_*",
            "arn:aws:iam::*:policy/Application_*",
            "arn:aws:iam::*:instance-profile/Application_*"
          ],
          "Effect": "Allow",
          "Sid": "AllowOtherIAMActions"
        }
      ]
    }
  }
}
```

</p>
</details>

<details>
<summary>Example payload to delete a permission set</summary>
<p>

```json
{
  "action": "delete",
  "permissionSetData": {
    "permissionSetName": "teamA-permissionSet"
  }
}
```

</p>
</details>

### Enterprise friendly account assignment life cycle

This solution enables enterprise friendly account assignment lifecycles through the following features:

- Using groups as the mechanism for the principal type, instead of an individual user
- Friendly names for groups and permission sets when creating account assignments
- Based on the configuration parameter, use either an S3 based interface/ Rest API interface to create/delete account assignments
- Create & delete account assignments with scope set to **account, root, ou_id or account_tag**
- Using the entity value passed in the payload, the solution calculates the account list and processes the account assignment operations on all the accounts automatically

<details>
<summary>Example paylod to provision permission set `teamA-permissionSet` for all accounts in your organization and provide access to `teamA` user group</summary>
<p>

```json
{
  "action": "create",
  "linkData": "root.all.teamA-permissionSet.teamA.ssofile"
}
```

</p>
</details>

<details>
<summary>Example paylod to provision permission set `teamA-permissionSet` for all accounts in your organization unit with ID `ou-id12345` and provide access to `teamA` user group</summary>
<p>

```json
{
  "action": "create",
  "linkData": "ou_id.ou-id12345.teamA-permissionSet.teamA.ssofile"
}
```

</p>
</details>

<details>
<summary>Example paylod to provision permission set `teamA-permissionSet` for all accounts that have tagkey `team` set to value 'teamA' and provide access to `teamA` user group</summary>
<p>

```json
{
  "action": "create",
  "linkData": "account_tag.team^teamA.teamA-permissionSet.teamA.ssofile"
}
```

</p>
</details>

<details>
<summary>Example paylod to provision permission set `teamA-permissionSet` for account 123456789012 and provide access to `teamA` user group</summary>
<p>

```json
{
  "action": "create",
  "linkData": "account.123456789012.teamA-permissionSet.teamA.ssofile"
}
```

</p>
</details>

### Automated access change management for account_tag,ou_id and root scopes

The solution provides automated change access management through the following features:

- If an account assignment has been created through the solution with scope set to root, and if a new account has been created at a later time, this new account is automatically provisioned with the account assignemnt.
- If an account assignment has been created through the solution with scope set to ou_id, and an existing account moves out of this ou, this account assignment is automatically deleted from the account by the solution. If a new account is moved in to the ou, this account assignment is automatically created for the account by the solution.
- If an account assignment has been created through the solution with scope set to account_tag, and an account is updated with this tag key value at a later time, this account assignment is automatically created for the new account by the solution. Additionally, when this tag key value is removed from the account/when this tag key is updated to a different value on the account at a later time, this account assignment is automatically deleted from the account by the solution.

### De-couple life cycle management of different SSO objects and other features

- The solution enables de-coupling creation of permission sets , user groups and account assignment operations completely. They could be created in any sequence, thereby enabling enterprise teams to handle these objects lifecycles through different workflow process that align to their needs, and the solution would handle the target state appropriately
- The solution enables usage of friendly names in managing permission set, account assignment life cycles and would handle the translation of friendly names into internal AWS SSO GUID's automatically
- The solution enables deployment in a distributed model i.e. orgmain, deployment and target account (or) in a single account model i.e. orgmain only. It's recommended that single account model of deployment be used only for demonstration purposes
- The solution assumes that AWS SSO is enabled in a different account other than orgmain account and has the required cross-account permissions setup to enable the functionalities. This future-proofs the solution to support the scenario when AWS SSO service releases delegated admin support similar to other services such as GuardDuty

## [How to Deploy](docs/documentation/How-To-Deploy.md)

<!-- TODO update link to public workshop -->

## [Start Using](https://studio.us-east-1.prod.workshops.aws/preview/67ce7a7b-48aa-4b83-b9d4-98c3babbef8d/builds/67a01a15-d723-48bb-8412-5123efad201a/en-US/)

## [Detailed Building Blocks Overview](docs/documentation/Building-Blocks.md)

## [Solution Overview diagrams](docs/documentation/Overview-diagrams.md)

## [Use case Logical State Flows](docs/documentation/Use-Case-Logical-State-Flows.md)

## [Example Use case: Using aws-sso-extensions-for-enterprise with SailPoint and ADFS](docs/documentation/Example-Use-case.md)

## Security

See [CONTRIBUTING](CONTRIBUTING.md) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.

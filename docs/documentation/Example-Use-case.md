# aws-sso-extensions-for-enterprise with SailPoint and ADFS

`AWS SSO Extensions for Enterprise` solution is built with the objective to enable enterprise customers to better integrate AWS SSO with their current identity and access management tools.

Below is a reference design comparing and contrasting how enterprises handled multi account federation to AWS and how this is enhanced with the introduction of `AWS SSO` along with `AWS SSO Extensions for Enterprise` solution. For this example, we consider the scenario where an enterprise customer is using ADFS as the IDP, SailPoint as the enterprise identity and access management tool, ServiceNow as the request interface system and is now moving to AWS SSO along with the `AWS SSO Extensions for Enterprise solution`.

While the design is explained referencing these tools/technologies for easy readability, it is to be noted that the same logical flows and concepts apply to other tools/technologies the customer may use. For ex, if a customer uses RSA Identity as their IAM tool of choice, the implementation of the "Access Scope" life cycle use case would vary , however the design would still remain the same

## Access management - ADFS versus AWS SSO

In the first section, let us take a look at the granularity to which AD groups are created and maintained when using the current model of ADFS and federating into the AWS SAML end point defined by `https://signin.aws.amazon.com/static/saml-metadata.xml` versus using `AWS SSO` as the SSO provider along with `AWS SSO Extensions for Enterprise solution`

To better explain and help visualise the differences in the models, we **use the construct “Access scope” to group together related permissions**. And we identity **“Access scope” as the combination of Entity + Permissions**. The Entity and Permissions objects differ in the models and this is explained below

### ADFS model

- Here, the “Access scope” by way of model design is
  - **Entity = an individual AWS account only**
  - **Permissions = an IAM role**
- In this model, Permissions are to be defined in every single entity (AWS account) by way of scripts and updates to the permissions are to be cascaded to every single entity (AWS account) by way of scripts as well
- In a scenario where a set of users need to be granted **the same permissions (i..e IAM role) across a specific set of entities (account(s))**, given the “Access scope” is on a per account basis only, you need to **create AD group(s) that match the total no of entities = { no of account(s) }**
  - For ex, `My App` team needs access to **entities={ Account01, Account02, Account03} + permission={IAM role called `MyAppTeam`-RoleA}** , then the resulting AD groups would be
    - AWS-Account01-`MyAppTeam`-DevRoleA
    - AWS-Account02-`MyAppTeam`-DevRoleA
    - AWS-Account03-`MyAppTeam`-DevRoleA
  - If more accounts need to be added/removed to the entities list i.e. `MyApp` app teams needs access to a new account using DevRoleA / `MyApp` no longer needs access to an existing account using DevRoleA , the corresponding AD group needs to be created/deleted
- In a scenario where a set of users need to be granted **the same permissions (i.e. IAM role) across an entity (organisational unit)**, given the “Access scope” is on a per account basis only, you need to **create AD group(s) that match the total no of\* \*entities = { no of accounts in the organisational unit }**
  - For ex, Ops Team needs access to **entity={ ou_id_01 } + permission = { IAM role called `OpsTeam`-Ops} , and ou_id_01 has 4 accounts {Account10,Account11,Account12,Account13},** then the resulting AD groups would be
    - AWS-Account10-`OpsTeam`-Ops
    - AWS-Account11-`OpsTeam`-Ops
    - AWS-Account12-`OpsTeam`-Ops
    - AWS-Account13-`OpsTeam`-Ops
  - In this model, as accounts move in and out of the **entity(organisational unit) ,**the corresponding AD groups needs to be added or removed
    - For ex, if an account {Account14} has been added to the **entity={ ou_id_01 }**, then a new AD group needs to be added
      - AWS-Account14-`OpsTeam`-Ops
    - Now, if an account {Account13} has been removed from the **entity={ ou_id_01 }**, then the existing AD group needs to be deleted
      - AWS-Account13-`OpsTeam`-Ops
- In a scenario where a set of users need to be granted **the same permissions (i.e. IAM role) across an entity (root) i.e. all the accounts in the organisation**, given the “Access scope” is on a per account basis only, you need to **create AD group(s) that match the total no of entities = { no of accounts in the organisation }**
  - For ex, if `CCOE` team needs access to **entity={ root } + permission = { IAM role called `CCOE`-Ops }, and the organisation has a total of 20 AWS accounts,**then the resulting AD groups would be
    - 20 different AD groups with a naming convention of AWS-AccountNo-`CCOE`-Ops
  - As accounts are added and removed, the same group addition / removal constraints apply as described previously
- In a scenario where a set of users need to be granted **the same permissions (i.e. IAM role) across all the accounts in the organisation that match a certain tag key value combination**, given the “Access scope” is on a per account basis only, you need to **create AD group(s) that match the total no of entities = { no of accounts in the organisation that match the tag key combination}**
  - For ex, if `CCOE` team needs access to **entity={ accounts matching tagkey value pair } + permission = { IAM role called `CCOE`-Audit }, and the organisation has a total of 5 AWS accounts that match the tagkey value pair,**then the resulting AD groups would be
    - 5 different AD groups with a naming convention of AWS-AccountNo-`CCOE`-Audit
  - As accounts have the tagkey pair added and removed/updated, the same group addition / removal constraints apply as described previously

### AWS SSO + Automation Solution Model

- The design considers SailPoint invoking API’s as part of the access provisioning model. For the purpose of this model, assume SailPoint is configured to invoke the API in the way we describe below. We will explain the SailPoint integration in the section after this.
- Here, the “Access scope” by way of model design is
  - **Entity = can be one of { an individual AWS account / collection of AWS accounts / ou_id / root }**
  - **Permissions = permission_set**
- In this model, Permissions are created and managed across all the accounts in the organisation through the automation solution
- In a scenario where a set of users need to be granted **the same permissions (i..e permission set) across a specific set of entities (account(s))**, given the “Access scope” can be one of { an individual AWS account / collection of AWS accounts / ou_id / root }, you need to **create 1 AD group and SailPoint will call the postLinkData API iterating no of times = {no of account(s) }**
  - For ex, `MyApp` app teams needs access to **entities={ Account01, Account02, Account03} + permission={permission_set called PermissionSetA}** ,
    - an AD groups is created with name = AWS-`MyAppTeam`-PermissionSetA , and group attributes of
      - scope = account
      - entity_list = {account01, account02, account03}
      - additional group attributes as necessary are created
    - SailPoint will call postLinkData API 3 times with the following payload
      - {action: “create”, linkData: “account.account01.PermissionSetA.AWS-`MyAppTeam`-PermissionSetA.ssofile”}
      - {action: “create”, linkData: “account.account02.PermissionSetA.AWS-`MyAppTeam`-PermissionSetA.ssofile”}
      - {action: “create”, linkData: “account.account03.PermissionSetA.AWS-`MyAppTeam`-PermissionSetA.ssofile”}
  - If more accounts need to be added/removed to the entities list i.e. `MyApp` app teams needs access to a new account using PermissionSetA / `MyApp` no longer needs access to an existing account using PermissionSetB , then the AD group(with name=AWS-`MyAppTeam`-PermissionSetA) attribute account_list will be updated appropriately, and SailPoint will call the postLinkData with the payload’s action set to “create” or “delete” as required
- In a scenario where a set of users need to be granted **the same permissions (i.e. permission set) across an entity (organisational unit)**, given the “Access scope” can be one of { an individual AWS account / collection of AWS accounts / ou_id / root }, you need to **create 1 AD group and SailPoint will call the postLinkData API 1 time only**
  - For ex, Ops Team needs access to **entity={ ou_id_01 } + permission = { permission set called PermissionSetManagedOps} , and ou_id_01 has 4 accounts {Account10,Account11,Account12,Account13}**
    - one AD group is created with name = AWS-`OpsTeam`-PermissionSetManagedOps, and group attributes of
      - scope = ou_id
      - entity_list = { ou_id_01 }
      - additional group attributes as necessary are created
    - SailPoint will call postLinkData API 1 time with the following payload
      - {action: “create”, linkData: “ou_id.ou_id_01.PermissionSetManagedOps.AWS-`OpsTeam`-PermissionSetManagedOps.ssofile”}
  - In this model, as accounts move in and out of the **entity(organisational unit)** no further actions are required on the AD group (or) from SailPoint calling API’s. The automation solution handles these changes for you.
- In a scenario where a set of users need to be granted **the same permissions (i.e. permission set) across an entity (root) i.e. all the accounts in the organisation**, given the “Access scope” can be one of { an individual AWS account / collection of AWS accounts / ou_id / root }, you need to **create 1 AD group and SailPoint will call the postLinkData API 1 time only**
  - For ex, if `CCOE` team needs access to **entity={ root } + permission = { permission set called PermissionSetFullAdmin }, and the organisation has a total of 20 AWS accounts**
    - one AD group is created with name = AWS-`CCOE`-PermissionSetFullAdmin, and group attributes of
      - scope = root
      - entity_list = { all }
      - additional group attributes as necessary are created
    - SailPoint will call postLinkData API 1 time with the following payload
      - {action: “create”, linkData: “root.all.PermissionSetFullAdmin.AWS-`CCOE`-PermissionSetFullAdmin.ssofile”}
  - In this model, as accounts are created and deleted in the **entity(root)** no further actions are required on the AD group (or) from SailPoint calling API’s. The automation solution handles these changes for you.
- In a scenario where a set of users need to be granted **the same permissions (i.e. IAM role) across all the accounts in the organisation that match a certain tag key value combination**, given the “Access scope” is on a per account basis only, you need to **create 1 AD group and SailPoint will call the postLinkData API 1 time only**
  - For ex, if `CCOE` team needs access to **entity={ all accounts matching a tag key value pair } + permission = { permission set called PermissionSetAudit }, and the organisation has a total of 5 AWS accounts that match this tagkey value pair**
    - one AD group is created with name = AWS-`CCOE`-PermissionSetAudit, and group attributes of
      - scope = account_tag
      - entity_list = { tagkey^tagvalue }
      - additional group attributes as necessary are created
    - SailPoint will call postLinkData API 1 time with the following payload
      - {action: “create”, linkData: “account_tag.tagKey^tagValue.PermissionSetAudit.AWS-`CCOE`-PermissionSetAudit.ssofile”}
  - In this model, as accounts are modified further with the tagkey value pair being added/removed/updated no further actions are required on the AD group (or) from SailPoint calling API’s. The automation solution handles these changes for you.

## How does this new model and solution work with SailPoint?

### **Use cases**

- From a use case perspective, SailPoint needs to handle 2 use cases:

1. Handle create/update/delete life cycles of “Access scope” elements that are described above
2. Handle AD group membership assignment and removal

- The solution focusses on use case 1 only. Use case 2 is already handled by SailPoint and is a common use case, so that’s not touched upon here. The only addition we are introducing to use case 2 is adding logic whether adding/removing members from an AD group requires approval and who the approvers are (by way of approval_type and approver_group)

#### **“Access scope” Life Cycle Use Case**

- The objective of this use case is to ensure that the create/update/delete operations of “Access scope” elements are handled by SailPoint

##### **Pre-requisites**

- This use case requires that all the permission set objects are created in AWS SSO using the postPermissionSetData API prior to the execution of the solution. These permission set objects can be updated at a later stage if required and the automation solution would handle the re-deployment of the updated permission sets automatically, however the initial version should be created in AWS SSO.

##### **Considerations**

- Since AWS SSO does not yet have an API for managing AD groups, the design assumes that when an AD group is created/deleted by SailPoint as part of “access scope” life cycle use case, it creates a SNOW ticket with resolver group in SNOW set to `CCOE` team for creating/deleting the linked AD group inside AWS SSO. This manual intervention is only required during an AD group create/delete operation only. Group memberships synchronisation and AD user life cycles are automatically handled by AWS SSO. This limitation does not apply when RWE moves to Azure AD as SSO supports automatic inbound provisioning via SCIM 2.0.

##### **Design**

- The design of the solution would include SailPoint exposing a “postAccessScopeData” API that would take in the following payload
  - action → should be one of {create, delete, addAccount, removeAccount}
  - scope → should be empty or one of {account, ou_id, root, account_tag}
  - permissions → should be permission set name
  - entity_list → should be empty or one of {accountno#,[list of account no’s#], ou_id_value#, account_tag_key^account_tag_value, all}
  - team_name → should be target team name for which this access scope is being provisioned
  - approval_type → should be empty or one of {auto,resolver_group}
  - approver_group → should be empty or referencing another AD group name
- The interface for sending payload to “postAccessScopeData” API would be via a SNOW ticket with the required validation built in( either at a SNOW level, or at the SailPoint API level)
- $notation is used where the service should substitute values from the payload received in “postAccessScopeData” API
- \#notation is used where the service should substitute values from the AD group object
- The service implementation should adhere to the following specification
  - Enforce payload validation through the following rules:
    - For addAccount/removeAccount action types, the following parameters should be empty
      - $scope
      - $approval_group
      - $approval_type
    - For delete action types, the following parameters should be empty
      - $scope
      - $entity_list
      - $approval_type
      - $approval_group
    - All parameters are non empty in all other cases
    - In an addAccount/removeAccount action type, size of $entity_list should be equal to 1
    - When $scope is set to “root”, size of of $entity_list should be equal to 1
  - If ((action=create) && (scope in {root}))
    - create AD group with name = AWS-$team_name-$permissions with the following attributes
      - \#scope set from $scope
      - \#entity_list set from $entity_list
      - \#approval_type set from $approval_type
      - \#approver_group set from $approver_group
    - call postLinkData API with the following payload
      - {action: “create”, linkData: “$scope.$entity_list.$permissions.$AD-group-name.ssofile”}
    - create SNOW ticket with the action=create and group_name=AWS-$team_name-$permissions and resolver group in SNOW set to `CCOE`
  - If ((action=create) && (scope in {ou_id}))
    - create AD group with name = AWS-$team_name-$permissions with the following attributes
      - \#scope set from $scope
      - \#entity_list set from $entity_list
      - \#approval_type set from $approval_type
      - \#approver_group set from $approver_group
    - Iterate through $entity_list by calling postLinkData API with the following payload
      - {action: “create”, linkData: “$scope.$entity_list.$permissions.$AD-group-name.ssofile”}
    - create SNOW ticket with the action=create and group_name=AWS-$team_name-$permissions and resolver group in SNOW set to `CCOE`
  - If ((action=create) && (scope in {account}))
    - create AD group with name = AWS-$team_name-$permissions with the following attributes
      - \#scope set from $.scope
      - \#entity_list set from $.entity_list
      - \#approval_type set from $.approval_type
      - \#approver_group set from $.approver_group
    - Iterate through $entity_list by calling postLinkData API with the following payload
      - {action: “create”, linkData: “$scope.$entity_list[i].$permissions.$AD-group-name.ssofile”}
  - If (action=delete)
    - Calculate AD group name with AWS-$team_name-$permissions
    - Look up AD group, and if look up fails reject request with error else
    - Resolve scope attribute from the group
      - If (\#scope in {ou_id, root}) then call postLinkData API with the following payload
        - {action: “delete”, linkData: “\#scope.\#entity_list.\#permissions.\#AD-group-name.ssofile”}
      - If (\#scope in {account}) then iterate through call postLinkData API with the following payload
        - {action: “delete”, linkData: “\#scope.\#entity_list[i].\#permissions.\#AD-group-name.ssofile”}
    - Delete the AD group
    - create SNOW ticket with the action=delete and group_name=AWS-$team_name-$permissions and resolver group in SNOW set to `CCOE`
  - If (action=addAccount)
    - Calculate AD group name with AWS-$team_name-$permissions
    - Look up AD group, and if look up fails reject request with error else
    - call postLinkData API with the following payload
      - {action: “create”, linkData: “\#scope.$entity_list.$permissions.\#AD-group-name.ssofile”}
    - Update \#entity_list attribute by adding $entity_list to the attribute value list
  - If (action=removeAccount)
    - Calculate AD group name with AWS-$team_name-$permissions
    - Look up AD group, and if look up fails reject request with error else
    - call postLinkData API with the following payload
      - {action: “delete”, linkData: “\#scope.$entity_list.$permissions.\#AD-group-name.ssofile”}
    - Update \#entity_list attribute by removing $entity_list from attribute value list

##### **The-What-If’s**

- In case SailPoint is unable to offer this integration, you could substitute this with the following
  - “postAccessScopeData” API would fall back to S3 object event notification based design
  - In place of raising a SNOW ticket for automated AD group handling and the subsequent SSO link handling, `CCOE` team would use s3 sync to maintain link data as necessary and interface with AD teams for group creation/deletion as necessary

### **Reference Payloads**

- Onboard access to multiple accounts for `MyApp` using PermissionSet A

```json
{
  “action” : “create”,
  “scope” : “account”,
  “permissions” : “PermissionSetA”,
  “entity_list: : ["account01","account02","account03"],
  “team_name”: “`MyAppTeam`”,
  “approval_type”: “resolver_group”,
  “approval_group”: “AWS-`MyAppTeam`-ApproverGroup”
}
```

- Add an account to already onboarded access for `MyApp` using PermissionSet A

```json
{
  “action” : “addAccount”,
  “permissions” : “PermissionSetA”,
  “entity_list: : ["account04"],
  “team_name”: “MyAppTeam” }
}
```

- Onboard access to two ou_id’s called ou_id_1 and ou_id_2 for `OpsTeam` using PermissionSetManagedOps

```json
{
  “action” : “create”,
  “scope” : “ou_id”,
  “permissions” : “PermissionSetManagedOps”,
  “entity_list: : [”ou_id_1“,”ou_id_2“],
  “team_name”: “MyAppTeam”,
  “approval_type”:
  “resolver_group”,
  “approval_group”: “AWS-`MyAppTeam`-ApproverGroup”
}
```

- Delete access to entire root for `CCOE` using PermissionSet`CCOE`

```json
{
  “action” : “delete”,
  “permissions” : “PermissionSet`CCOE`”,
  “team_name”: “`CCOE`”
}
```

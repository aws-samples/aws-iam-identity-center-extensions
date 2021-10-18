# Objective

The objective of this solution is to faciliate the following use cases when using AWS SSO service:

## Composite Permission Set API

### Problem Statement

The current Permission Set API's are a set of individual API's each tackling one element of the permission set. For ex, CreatePermissionSet action allows you to
create Permission set with name, tag, sessionDuration in ISO8601 format and relay state. This requires additional API calls to attach/remove Managed policies and create/update/delete
inline policy attached to the permission set. When the requirement is to handle permission set lifecycles at scale, this becomes challenging. Additionally, update and delete operations
need a permissionSetArn reference (and not the friendly name reference) which needs to be fetched prior to the operation.

### How is the problem solved?

The solution provides a composite API for permission set lifecycle which provides the following:

- Create a complete permission set object including the characteristicis, managed policies, inline policy in a single call
- Update parts(to any granularity)/complete permission set object in a single call
- Delete a complete permission set in a single call
- Update/delete by referring to the friendly name instead of the permissionSetArn value
- Based on the configuration parameter , use either an S3 based interface/ Rest API interface to upload permission set object as a whole
- Handle at scale use cases by implementing the permission set life cycle using fan out pattern and asynchronous processing
- Hanlde synchronous operational errors feedback via an email subscription of an SNS topic
- Implement custom boto3 based waiters to handle asynchronous operational errors feedback via an email subscription of an SNS topic
- Enforce the "cannot delete" constraint when a permission set is being referenced in an entitlement

## Enterprise friendly entitlement management

### Problem Statement

The current entitlement API's (createAccountAssignment, deleteAccountAssignment) use SSO generated Arn's for referencing the principalId , instanceArn, permissionSetArn. Additionally, the
current entitlement API's are account-level only and do not handle organisation based entitlement provisioning/de-provisioning. This requires enterprises to maintain a mapping reference between
the SSO generated GUID's and the enterprise identity store object names. Additionally, enterprises will need to build logic that would help automate their SSO provisioining use cases for organizational use cases.

### How is the problem solved?

The solution enables enterprise friendly entitlement management through the following features:

- Use groups as the mechanism for principal type instead of an individual user
- Reference, friendly names for groups, permission sets when creating entitlement links instead of Arn values
- Based on the configuration parameter, use either an S3 baased interface/ Rest API interface to create/delete entitlement links
- Use organizational features that the solution enables
  - Create/Delete entitlement links with scope set to one of account, root or ou_id
  - Using the entity value passed in the payload, the solution calculates the account list and processes the create/delete account assignment operation for you
  - The solution also deploys in us-east-1 to handle future organizational changes.
    - For ex, if an entitlement has been created through the solution with scope set to root, and if a new account has been created at a later time, this entitlement is automatically provisioned into the new
      account by the solution
    - Also, if an entitlement has been created through the solution with scope set to ou_id, and an existing account moves out of this ou, this entitlement is automatically de-provisioned from the
      account by the solution. If an account is moved in to the ou, this entitlement is automatically provisioned into the account by the solution
    - If an entitlement has been created through the solution with scope set to account_tag, and if an account is tagged with this tag key pair at a later time, this entitlement is automatically provisioned into the new account by the solution
- Enable out of band integration between group life cycles and entitlement life cycles
  - The solution listens on SSO group creation/deletion events (from any source - SCIM/Console/CLI etc) and handles out of band integration use cases with entitlements
  - The solution facilitates creation of groups and entitlements in any order you choose. Irrespective of which sequence these objects are created, the corresponding provisioning/de-provisioning operation is handled by the solution
  - The solution translates the group name to GUID translation on your behalf, enabling you to specify your entitlements using friendly names
- Handle at scale use cases by implementing the permission set life cycle using fan out pattern and asynchronous processing
- Hanlde synchronous operational errors feedback via an email subscription of an SNS topic
- Implement custom boto3 based waiters to handle asynchronous operational errors feedback via an email subscription of an SNS topic

# Start Using

## S3 Interface for provisioning

- The recommendation is to maintain a local folder with links_data and permission_sets subfolders.
- Inside the respective subfolders, create/update/delete permission set and link files.
- It is recommended to use s3 sync for synchronising changes from local folder to S3.
  - `aws s3 sync local-folder/links_data/ s3_links_location_from_stack_output --delete`
  - `aws s3 sync local-folder/permission_sets/ s3_permission_sets_location_from_stack_output --delete`
- Use `samples/` for reference files

### Permission Set file details

- The file name should match the combinaton of permission set name(exact case) and a suffix of .json
- The file should contain all the element definitions. Even if an element is empty, for ex a permission set does not have inline policy, the element should be present with an empty JSON
- It is recommended to use versionid for tracking version
- Creation of file maps to create operation, Update of file content maps to update operation, deletion of the file maps to delete operation

### Link file details

- For using the S3 interface, the link file has a naming convention of `entityType.entityData.permissionSetName.groupName.ssofile`
- Here `entityType' could be one of {account, ou_id, root}
  - In case of `entityType` being set to `root`, `entityValue` should be set to `all`
  - In case of `entityType` being set to `ou_id`, `entityValue` should be set to `the corresponding ou_id`
  - In case of `entityType` being set to `account`, `entityValue` should be set to `the corresponding accont_id`
  - In case of `entityType` being set to `account_tag`, `entityValue` should be set in the format of `tagkey^tagvalue`
- The file itself is an empty file with no content
- Creation of file maps to create operation, deletion of file maps to delete operation, update of file name maps to a delete with old file name details and a create with new file name details

## API Interface

- Import the `postman collection` from `samples/postman-collection` into your PostMan client
- Create an environment with the following variables (with the exact name convention as the sample references these variables)

  - linksEndpoint - set to value from the stack output
  - permissionSetEndpoint - set to value from the stack output
  - region - set to region of your deployment
  - accessKey, secretAccessKey, sessionToken - set to STS credentials vended from link-api-caller-role-arn or permissionset-api-caller-role-arn depending on your current use case

- Using the sample payloads provided as reference

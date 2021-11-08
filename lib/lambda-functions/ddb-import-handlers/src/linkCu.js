/*
Objective: Implement event notification handler for link objects S3 path
Trigger source: link S3 path object notification for both created and change type events
- Schema validation of the file name
- Upsert in links DDB table parsing the file name
*/

// Environment configuration read
const { DdbTable, errorNotificationsTopicArn, AWS_REGION } = process.env;

// SDK and third party client imports
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION });

// Error topic initialisation
const errorParams = {
  TopicArn: errorNotificationsTopicArn,
};
const errorMessage = {};
errorMessage.Subject = 'Error Processing Link Create/Update via S3 Interface';

// Load JSON data to DynamoDB table
const ddbLoader = async (data) => {
  // Set up the params object for the DDB call
  const params = {
    TableName: DdbTable,
    Item: { ...data },
  };
  // Push to DynamoDB
  try {
    await ddbDocClientObject.send(new PutCommand(params));
  } catch (err) {
    console.error('Excpetion in ddbLoader for linkCu: ', err);
  }
};

// The Lambda handler
exports.handler = async (event) => {
  try {
    await Promise.all(
      event.Records.map(async (record) => {
        try {
          const fileName = decodeURIComponent(
            record.s3.object.key.split('/')[1],
          );

          if (
            /root\.all\.[\w+=,.@-]{1,32}\.[a-zA-Z0-9-_@\.\s]+\.ssofile/gm.test(
              fileName,
            )
            || /ou_id\.ou-[a-z0-9]{4}-[a-z0-9]{8}\.[\w+=,.@-]{1,32}\.[a-zA-Z0-9-_@\.\s]+\.ssofile/gm.test(
              fileName,
            )
            || /account\.\d{12}\.[\w+=,.@-]{1,32}\.[a-zA-Z0-9-_@\.\s]+\.ssofile/gm.test(
              fileName,
            )
            || /account_tag\.[\w+=,.@-]{1,128}\^[\w+=,.@-]{1,256}\.[\w+=,.@-]{1,32}\.[a-zA-Z0-9-_@\.\s]+\.ssofile/gm.test(
              fileName,
            )
          ) {
            const delimeter = '.';
            const keyValue = fileName.split(delimeter);
            const linkData = {
              awsEntityId: fileName,
              awsEntityType: keyValue[0],
              awsEntityData: keyValue[1],
              permissionSetName: keyValue[2],
              // Handle cases where groupName contains one or more delimeter characters
              groupName: keyValue.slice(3, -1).join(delimeter),
            };
            await ddbLoader(linkData);
            console.log(
              `Procssed upsert of link data through S3 interface successfully: ${linkData}`,
            );
          } else {
            errorMessage.event_detail = event;
            errorMessage.error_details = 'File name does not pass the schema validation for a link operation';
            errorParams.Message = JSON.stringify(errorMessage);
            await snsClientObject.send(new PublishCommand(errorParams));
          }
        } catch (err) {
          console.error('Exception in async loop for linkCu: ', err);
        }
      }),
    );
  } catch (err) {
    console.error('Exception in main handler for linkCu: ', err);
    errorMessage.event_detail = event;
    errorMessage.error_details = err;
    errorParams.Message = JSON.stringify(errorMessage);
    await snsClientObject.send(new PublishCommand(errorParams));
  }
};

/*
Objective: Implement event notification handler for link objects S3 path
Trigger source: link S3 path object notification for removed type events
- Schema validation of the file name
- delete in links DDB table parsing the file name
*/

// Environment configuration read
const { DdbTable, errorNotificationsTopicArn, AWS_REGION } = process.env;

// SDK and third party client imports
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
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
errorMessage.Subject = 'Error Processing Link Delete via S3 Interface';

// Remove JSON data from DynamoDB table
const ddbCleaner = async (key) => {
  const params = {
    TableName: DdbTable,
    Key: {
      ...key,
    },
  };

  // Delete from DynamoDB
  try {
    await ddbDocClientObject.send(new DeleteCommand(params));
  } catch (err) {
    console.error('Error with ddbCleaner in linkDel: ', err);
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
            await ddbCleaner({
              awsEntityId: fileName,
            });
            console.log(
              `Procssed deletion of link data through S3 interface successfully: ${fileName}`,
            );
          } else {
            errorMessage.event_detail = event;
            errorMessage.error_details = 'File name does not pass the schema validation for a link operation';
            errorParams.Message = JSON.stringify(errorMessage);
            await snsClientObject.send(new PublishCommand(errorParams));
          }
        } catch (err) {
          console.error('Exception in async loop in linkDel: ', err);
        }
      }),
    );
  } catch (err) {
    console.error('Exception in main handler of linkDel: ', err);
    errorMessage.event_detail = event;
    errorMessage.error_details = err;
    errorParams.Message = JSON.stringify(errorMessage);
    await snsClientObject.send(new PublishCommand(errorParams));
  }
};

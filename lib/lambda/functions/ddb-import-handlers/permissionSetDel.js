/*
Objective: Implement event notification handler for permission set objects S3 path
Trigger source: permission set S3 path object notification for removed type events
- Schema validation of the file name
- delete in permission set DDB table parsing the file name
*/

// Environment configuration read
const {
  DdbTable, linksTable, errorNotificationsTopicArn, AWS_REGION,
} = process.env;

// SDK and third party client imports
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  DeleteCommand,
  QueryCommand,
} = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION });

const errorParams = {
  TopicArn: errorNotificationsTopicArn,
};
const errorMessage = {};
errorMessage.Subject = 'Error Processing Permission Set Delete via S3 Interface';

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
    console.error('Exception in ddbCleaner in permissionSetDel: ', err);
  }
};

// The Lambda handler
exports.handler = async (event) => {
  await Promise.all(
    event.Records.map(async (record) => {
      try {
        const s3Key = record.s3.object.key;
        const key = {};
        const keyIndex = s3Key.split('/')[0];
        const keyValue = s3Key.split('/')[1].split('.')[0];
        let formattedKeyIndex = '';
        if (keyIndex === 'permission_sets') {
          formattedKeyIndex = 'permissionSetName';
        }
        key[formattedKeyIndex] = keyValue;
        const realtedLinks = await ddbDocClientObject.send(
          // QueryCommand is a pagniated call, however the logic requires
          // checking only if the result set is greater than 0
          new QueryCommand({
            TableName: linksTable,
            IndexName: 'permissionSetName',
            KeyConditionExpression: '#permissionSetName = :permissionSetName',
            ExpressionAttributeNames: {
              '#permissionSetName': 'permissionSetName',
            },
            ExpressionAttributeValues: { ':permissionSetName': keyValue },
          }),
        );
        if (realtedLinks.Items.length !== 0) {
          console.error(
            'Cannot delete permission set as there are existing links that reference the permission set',
          );
          errorMessage.event_detail = event;
          errorMessage.error_details = 'Cannot delete permission set as there are existing links that reference the permission set';
          errorParams.Message = JSON.stringify(errorMessage);
          await snsClientObject.send(new PublishCommand(errorParams));
        } else {
          await ddbCleaner(key);
          console.log(
            `processed deletion of permission set through S3 interface succesfully: ${keyValue}`,
          );
        }
      } catch (err) {
        console.error('Exception in main handler in permissionSetDel: ', err);
        errorMessage.event_detail = event;
        errorMessage.error_details = err;
        errorParams.Message = JSON.stringify(errorMessage);
        await snsClientObject.send(new PublishCommand(errorParams));
      }
    }),
  );
};

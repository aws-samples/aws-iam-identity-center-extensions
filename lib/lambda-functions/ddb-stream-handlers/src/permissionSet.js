/*
Objective: Implement permission set table DDB changes for link processing functionality
Trigger source: permission set DDB table stream notifications for NEW_AND_OLD_IMAGES
- For each record in the stream,
    - determine the change type i.e. INSERT, MODIFY, DELETE
    - post the changes to the permission set topic handler
- Catch all failures in a generic exception block and
  post the error details to error notifications topics
*/

// Environment configuration read
const { topicArn, errorNotificationsTopicArn, AWS_REGION } = process.env;

// SDK and third party client imports
/* eslint-disable  @typescript-eslint/no-var-requires */
const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
/* eslint-disable  @typescript-eslint/no-var-requires */
const DynamoStreamDiff = require("dynamo-stream-diff");

// SDK and third party client object initialistaion
const snsClientObject = new SNSClient({ region: AWS_REGION });

// Error topic
const errorParams = {
  TopicArn: errorNotificationsTopicArn,
};
const errorMessage = {};
errorMessage.Subject =
  "Error Processing Permission set DDB table stream records";

exports.handler = async (event) => {
  try {
    await Promise.all(
      event.Records.map(async (record) => {
        const params = {
          TopicArn: topicArn,
        };
        const message = {};
        message.event_type = record.eventName;
        message.record = record;
        if (record.eventName === "INSERT") {
          // insert recieved
        } else if (record.eventName === "MODIFY") {
          const diff = DynamoStreamDiff(record);
          message.diff = diff;
        } else if (record.eventName === "REMOVE") {
          // remove record
        }
        params.Message = JSON.stringify(message);
        await snsClientObject.send(new PublishCommand(params));
        console.log(
          `Successfully posted to permissionset topic from permissionset stream handler content: ${JSON.stringify(
            message
          )}`
        );
      })
    );
    return "Successfully processed all records in the current stream shard";
  } catch (err) {
    console.error(
      "main handler exception in permissionSet stream handler: ",
      err
    );
    errorMessage.event_detail = event;
    errorMessage.error_details = err;
    errorParams.Message = JSON.stringify(errorMessage);
    await snsClientObject.send(new PublishCommand(errorParams));
    return err;
  }
};

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
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { DynamoDBRecord, DynamoDBStreamEvent } from "aws-lambda";
import { DynamoStreamDiff } from "dynamo-stream-diff";
import { ErrorMessage } from "../../helpers/src/interfaces";

// SDK and third party client object initialistaion
const snsClientObject = new SNSClient({ region: AWS_REGION });

//Error notification
let errorMessage: ErrorMessage = {
  Subject: "Error Processing Permission set DDB table stream records",
};

export const handler = async (event: DynamoDBStreamEvent) => {
  try {
    await Promise.all(
      event.Records.map(async (record: DynamoDBRecord) => {
        let diff;
        if (record.eventName === "MODIFY") {
          diff = DynamoStreamDiff(record);
        }
        await snsClientObject.send(
          new PublishCommand({
            TopicArn: topicArn,
            Message: JSON.stringify({
              event_type: record.eventName,
              diff: diff,
              record: record,
            }),
          })
        );
        console.log(
          `Successfully posted to permissionset topic from permissionset stream handler content: ${JSON.stringify(
            record
          )}`
        );
      })
    );
  } catch (err) {
    await snsClientObject.send(
      new PublishCommand({
        TopicArn: errorNotificationsTopicArn,
        Message: JSON.stringify({
          ...errorMessage,
          eventDetail: event,
          errorDetails: err,
        }),
      })
    );
    console.error(
      `Exception when processing permission set stream handling: ${JSON.stringify(
        err
      )} for eventDetail: ${JSON.stringify(event)}`
    );
  }
};

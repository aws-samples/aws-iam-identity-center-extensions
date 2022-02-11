/*
Objective: Implement event notification handler for link objects S3 path
Trigger source: link S3 path object notification for removed type events
- Schema validation of the file name
- delete in links DDB table parsing the file name
*/

// Environment configuration read
const {
  DdbTable,
  errorNotificationsTopicArn,
  AWS_REGION,
  linkProcessingTopicArn,
} = process.env;

import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { DeleteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { S3Event, S3EventRecord } from "aws-lambda";
import {
  ErrorMessage,
  LinkS3Payload,
  requestStatus,
} from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";
import Ajv from "ajv";
import { readFileSync } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import {
  imperativeParseJSON,
  JSONParserError,
} from "../../helpers/src/payload-validator";
// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });

//Error notification
const errorMessage: ErrorMessage = {
  Subject: "Error Processing Link delete via S3 Interface",
};

const ajv = new Ajv({ allErrors: true });
const schemaDefinition = JSON.parse(
  readFileSync(
    join("/opt", "nodejs", "payload-schema-definitions", "Link-S3.json")
  )
    .valueOf()
    .toString()
);
const validate = ajv.compile(schemaDefinition);

export const handler = async (event: S3Event) => {
  await Promise.all(
    event.Records.map(async (record: S3EventRecord) => {
      const requestId = uuidv4().toString();
      try {
        const fileName = decodeURIComponent(record.s3.object.key.split("/")[1]);
        console.log(`fileName received: ${fileName}`);
        const payload: LinkS3Payload = imperativeParseJSON(
          { linkData: fileName },
          validate
        );
        const { linkData } = payload;
        await ddbDocClientObject.send(
          new DeleteCommand({
            TableName: DdbTable,
            Key: {
              awsEntityId: linkData,
            },
          })
        );
        await snsClientObject.send(
          new PublishCommand({
            TopicArn: linkProcessingTopicArn + "",
            Message: JSON.stringify({
              linkData: linkData,
              action: "delete",
              requestId: requestId,
            }),
          })
        );
        logger({
          handler: "userInterface-s3Delete",
          logMode: "info",
          relatedData: linkData,
          requestId: requestId,
          status: requestStatus.InProgress,
          hasRelatedRequests:
            linkData.split("%")[0] === "account" ? false : true,
          statusMessage: `Account Assignment delete operation is being processed`,
        });
      } catch (err) {
        if (err instanceof JSONParserError) {
          logger({
            handler: "userInterface-s3Delete",
            logMode: "error",
            requestId: requestId,
            status: requestStatus.FailedWithException,
            statusMessage: `Error processing link operation through S3 interface due to schema errors for: ${JSON.stringify(
              err.errors
            )}`,
          });
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Message: JSON.stringify({
                errorMessage: `Error processing link operation through S3 interface due to schema errors`,
                errors: err.errors,
              }),
            })
          );
        } else {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Message: JSON.stringify({
                ...errorMessage,
                eventDetail: record,
                errorDetails: err,
              }),
            })
          );
          logger({
            handler: "userInterface-s3Delete",
            logMode: "error",
            requestId: requestId,
            status: requestStatus.FailedWithException,
            statusMessage: `Account Assignment delete operation failed with error: ${JSON.stringify(
              err
            )}`,
          });
        }
      }
    })
  );
};

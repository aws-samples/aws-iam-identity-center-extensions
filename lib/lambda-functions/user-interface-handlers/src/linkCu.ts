/*
Objective: Implement event notification handler for link objects S3 path
Trigger source: link S3 path object notification for both created and change type events
- Schema validation of the file name
- Upsert in links DDB table parsing the file name
*/

// Environment configuration read
const {
  DdbTable,
  errorNotificationsTopicArn,
  AWS_REGION,
  linkProcessingTopicArn,
} = process.env;

// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { S3Event, S3EventRecord } from "aws-lambda";
import {
  ErrorMessage,
  LinkData,
  requestStatus,
} from "../../helpers/src/interfaces";
import { logger } from "../../helpers/src/utilities";
import { v4 as uuidv4 } from "uuid";
// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION });

//Error notification
const errorMessage: ErrorMessage = {
  Subject: "Error Processing Link create/update via S3 Interface",
};

export const handler = async (event: S3Event) => {
  await Promise.all(
    event.Records.map(async (record: S3EventRecord) => {
      const requestId = uuidv4().toString();
      try {
        const fileName = decodeURIComponent(record.s3.object.key.split("/")[1]);
        if (
          /root\.all\.[\w+=,.@-]{1,32}\.[a-zA-Z0-9-_@.\s]+\.ssofile/gm.test(
            fileName
          ) ||
          /ou_id\.ou-[a-z0-9]{4}-[a-z0-9]{8}\.[\w+=,.@-]{1,32}\.[a-zA-Z0-9-_@.\s]+\.ssofile/gm.test(
            fileName
          ) ||
          /account\.\d{12}\.[\w+=,.@-]{1,32}\.[a-zA-Z0-9-_@.\s]+\.ssofile/gm.test(
            fileName
          ) ||
          /account_tag\.[\w+=,.@-]{1,128}\^[\w+=,.@-]{1,256}\.[\w+=,.@-]{1,32}\.[a-zA-Z0-9-_@.\s]+\.ssofile/gm.test(
            fileName
          )
        ) {
          const keyValue = fileName.split(".");
          const upsertData: LinkData = {
            awsEntityId: fileName,
            awsEntityType: keyValue[0],
            awsEntityData: keyValue[1],
            permissionSetName: keyValue[2],
            groupName: keyValue.slice(3, -1).join("."),
          };
          await ddbDocClientObject.send(
            new PutCommand({
              TableName: DdbTable,
              Item: {
                ...upsertData,
              },
            })
          );
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: linkProcessingTopicArn + "",
              Message: JSON.stringify({
                linkData: fileName,
                action: "create",
                requestId: requestId,
              }),
            })
          );
          logger({
            handler: "userInterface-s3CreateUpdate",
            logMode: "info",
            relatedData: fileName,
            requestId: requestId,
            status: requestStatus.InProgress,
            hasRelatedRequests:
              upsertData.awsEntityType === "account" ? false : true,
            statusMessage: `Account Assignment create operation is being processed`,
          });
        } else {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Message: JSON.stringify({
                ...errorMessage,
                eventDetail: record,
                errorDetails: `File name does not pass the schema validation for a link operation: ${fileName}`,
              }),
            })
          );
          logger({
            handler: "userInterface-s3CreateUpdate",
            logMode: "error",
            relatedData: fileName,
            requestId: requestId,
            status: requestStatus.FailedWithError,
            statusMessage: `Account Assignment create operation failed due to fileName validation`,
          });
        }
      } catch (err) {
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
          handler: "userInterface-s3CreateUpdate",
          logMode: "error",
          requestId: requestId,
          status: requestStatus.FailedWithException,
          statusMessage: `Account Assignment create operation failed with error: ${JSON.stringify(
            err
          )}`,
        });
      }
    })
  );
};

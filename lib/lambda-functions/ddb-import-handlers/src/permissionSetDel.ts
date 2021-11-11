/*
Objective: Implement event notification handler for permission set objects S3 path
Trigger source: permission set S3 path object notification for removed type events
- Schema validation of the file name
- delete in permission set DDB table parsing the file name
*/

// Environment configuration read
const { DdbTable, linksTable, errorNotificationsTopicArn, AWS_REGION } =
  process.env;

// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import { S3Event, S3EventRecord } from "aws-lambda";
import {
  DeletePermissionSetDataProps,
  ErrorMessage,
} from "../../helpers/src/interfaces";
import { JSONParserError } from "../../helpers/src/payload-validator";

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION });

const errorMessage: ErrorMessage = {
  Subject: "Error Processing Permission Set delete via S3 Interface",
};

export const handler = async (event: S3Event) => {
  await Promise.all(
    event.Records.map(async (record: S3EventRecord) => {
      try {
        const keyValue = record.s3.object.key.split("/")[1].split(".")[0];
        const payload: DeletePermissionSetDataProps = {
          permissionSetName: keyValue,
        };
        const relatedLinks = await ddbDocClientObject.send(
          // QueryCommand is a pagniated call, however the logic requires
          // checking only if the result set is greater than 0
          new QueryCommand({
            TableName: linksTable,
            IndexName: "permissionSetName",
            KeyConditionExpression: "#permissionSetName = :permissionSetName",
            ExpressionAttributeNames: {
              "#permissionSetName": "permissionSetName",
            },
            ExpressionAttributeValues: { ":permissionSetName": keyValue },
          })
        );
        if (relatedLinks.Items?.length !== 0) {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Message: JSON.stringify({
                ...errorMessage,
                eventDetail: record,
                errorDetails:
                  "Cannot delete permission set as there are existing links that reference the permission set",
              }),
            })
          );
          console.error(
            "Cannot delete permission set as there are existing links that reference the permission set"
          );
        } else {
          // Delete from DynamoDB
          await ddbDocClientObject.send(
            new DeleteCommand({
              TableName: DdbTable,
              Key: {
                ...payload,
              },
            })
          );
          console.log(
            `processed deletion of permission set through S3 interface succesfully: ${keyValue}`
          );
        }
      } catch (err) {
        if (err instanceof JSONParserError) {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Message: JSON.stringify({
                ...errorMessage,
                eventDetail: record,
                errorDetails: { errors: err.errors },
              }),
            })
          );
          console.error(
            `Error processing permission set delete operation through S3 interface with schema errors: ${JSON.stringify(
              err.errors
            )}`
          );
        } else {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Message: JSON.stringify({
                ...errorMessage,
                eventDetail: record,
                errorDetails: `Error processing permissionSet delete via S3 interface with exception: ${err}`,
              }),
            })
          );
          console.error(
            `Error processing permissionSet delete via S3 interface with exception: ${JSON.stringify(
              err
            )}`
          );
        }
      }
    })
  );
};

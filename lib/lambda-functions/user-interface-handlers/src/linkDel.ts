/**
 * Objective: Implement event notification handler for link objects S3 path
 * Trigger source: link S3 path object notification for removed type events
 *
 * - Schema validation of the file name
 * - Delete in links DDB table parsing the file name
 */

const {
  DdbTable,
  errorNotificationsTopicArn,
  AWS_REGION,
  linkProcessingTopicArn,
  functionLogMode,
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;

import {
  DynamoDBClient,
  DynamoDBServiceException,
} from "@aws-sdk/client-dynamodb";
import {
  PublishCommand,
  SNSClient,
  SNSServiceException,
} from "@aws-sdk/client-sns";
import { DeleteCommand, DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import Ajv from "ajv";
import { S3Event, S3EventRecord } from "aws-lambda";
import { readFileSync } from "fs";
import { join } from "path";
import { v4 as uuidv4 } from "uuid";
import {
  LinkS3Payload,
  logModes,
  requestStatus,
} from "../../helpers/src/interfaces";
import {
  imperativeParseJSON,
  JSONParserError,
} from "../../helpers/src/payload-validator";
import {
  constructExceptionMessage,
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";

const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });

const ajv = new Ajv({ allErrors: true });
const schemaDefinition = JSON.parse(
  readFileSync(
    join("/opt", "nodejs", "payload-schema-definitions", "Link-S3.json"),
  )
    .valueOf()
    .toString(),
);
const validate = ajv.compile(schemaDefinition);

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
let linkDataValue = "";
const messageSubject =
  "Exception in account assignment delete operation through S3 interface";

export const handler = async (event: S3Event) => {
  await Promise.all(
    event.Records.map(async (record: S3EventRecord) => {
      const requestId = uuidv4().toString();
      logger(
        {
          handler: handlerName,
          logMode: logModes.Info,
          requestId: requestId,
          status: requestStatus.InProgress,
          statusMessage: `Account assignment delete operation started`,
        },
        functionLogMode,
      );
      try {
        const fileName = decodeURIComponent(
          record.s3.object.key.replace(/\+/g, " ").split("/")[1],
        );

        const payload: LinkS3Payload = imperativeParseJSON(
          { linkData: fileName },
          validate,
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Account assignment payload successfully parsed`,
          },
          functionLogMode,
        );
        const { linkData } = payload;
        linkDataValue = linkData;
        await ddbDocClientObject.send(
          new DeleteCommand({
            TableName: DdbTable,
            Key: {
              awsEntityId: linkData,
            },
          }),
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Successfully processed delete from Dynamo DB`,
            relatedData: linkDataValue,
            hasRelatedRequests:
              linkData.split("%")[0] === "account" ? false : true,
          },
          functionLogMode,
        );
        await snsClientObject.send(
          new PublishCommand({
            TopicArn: linkProcessingTopicArn + "",
            Message: JSON.stringify({
              linkData: linkData,
              action: "delete",
              requestId: requestId,
            }),
          }),
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Sent payload to account assignment processing topic`,
            relatedData: linkDataValue,
            hasRelatedRequests:
              linkData.split("%")[0] === "account" ? false : true,
          },
          functionLogMode,
        );
      } catch (err) {
        if (err instanceof JSONParserError) {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Subject: messageSubject,
              Message: constructExceptionMessage(
                requestId,
                handlerName,
                "Schema validation exception",
                `Provided account assignment ${linkDataValue} S3 file does not pass the schema validation`,
                JSON.stringify(err.errors),
              ),
            }),
          );
          logger({
            handler: handlerName,
            requestId: requestId,
            logMode: logModes.Exception,
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessageforLogger(
              requestId,
              "Schema validation exception",
              `Provided account assignment ${linkDataValue} S3 file does not pass the schema validation`,
              JSON.stringify(err.errors),
            ),
          });
        } else if (
          err instanceof SNSServiceException ||
          err instanceof DynamoDBServiceException
        ) {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Subject: messageSubject,
              Message: constructExceptionMessage(
                requestId,
                handlerName,
                err.name,
                err.message,
                linkDataValue,
              ),
            }),
          );
          logger({
            handler: handlerName,
            requestId: requestId,
            logMode: logModes.Exception,
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessageforLogger(
              requestId,
              err.name,
              err.message,
              linkDataValue,
            ),
          });
        } else {
          await snsClientObject.send(
            new PublishCommand({
              TopicArn: errorNotificationsTopicArn,
              Subject: messageSubject,
              Message: constructExceptionMessage(
                requestId,
                handlerName,
                "Unhandled exception",
                JSON.stringify(err),
                linkDataValue,
              ),
            }),
          );
          logger({
            handler: handlerName,
            requestId: requestId,
            logMode: logModes.Exception,
            status: requestStatus.FailedWithException,
            statusMessage: constructExceptionMessageforLogger(
              requestId,
              "Unhandled exception",
              JSON.stringify(err),
              linkDataValue,
            ),
          });
        }
      }
    }),
  );
};

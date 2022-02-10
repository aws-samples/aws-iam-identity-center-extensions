/*
Objective: Implement lambda proxy for link importer API
Trigger source: link API
- Schema validation of the payload
- Upsert / delete in links DDB table depending on the operation
*/

// Environment configuration read
const { DdbTable, AWS_REGION, artefactsBucketName, linkProcessingTopicArn } =
  process.env;

// Lambda types import
// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { PublishCommand, SNSClient } from "@aws-sdk/client-sns";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";
//Import validator function and dependencies
import Ajv from "ajv";
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { readFileSync } from "fs";
import { join } from "path";
import {
  LinkData,
  LinkPayload,
  requestStatus,
} from "../../helpers/src/interfaces";
import {
  imperativeParseJSON,
  JSONParserError,
} from "../../helpers/src/payload-validator";
import { logger } from "../../helpers/src/utilities";

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const s3clientObject = new S3Client({ region: AWS_REGION, maxAttempts: 2 });
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });
// Validator object initialisation
const ajv = new Ajv({ allErrors: true });
const schemaDefinition = JSON.parse(
  readFileSync(
    join("/opt", "nodejs", "payload-schema-definitions", "Link-API.json")
  )
    .valueOf()
    .toString()
);
const validate = ajv.compile(schemaDefinition);

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const requestId = uuidv4().toString();
  if (event.body !== null && event.body !== undefined) {
    try {
      const payload: LinkPayload = imperativeParseJSON(event.body, validate);
      const delimeter = "%";
      const { linkData } = payload;
      if (payload.action === "create") {
        const keyValue = linkData.split(delimeter);
        const linkParams: LinkData = {
          awsEntityId: linkData,
          awsEntityType: keyValue[0],
          awsEntityData: keyValue[1],
          permissionSetName: keyValue[2],
          // Handle cases where principalName contains one or more delimeter characters
          //principalName: keyValue.slice(3, -2).join(delimeter),
          principalName: keyValue[3],
          principalType: keyValue[4],
        };
        await s3clientObject.send(
          new PutObjectCommand({
            Bucket: artefactsBucketName,
            Key: `links_data/${linkData}`,
            ServerSideEncryption: "AES256",
          })
        );
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: DdbTable,
            Item: {
              ...linkParams,
            },
          })
        );
        await snsClientObject.send(
          new PublishCommand({
            TopicArn: linkProcessingTopicArn + "",
            Message: JSON.stringify({
              linkData: linkData,
              action: "create",
              requestId: requestId,
            }),
          })
        );
        logger({
          handler: "userInterface-linkApi",
          logMode: "info",
          relatedData: linkData,
          requestId: requestId,
          hasRelatedRequests:
            linkParams.awsEntityType === "account" ? false : true,
          status: requestStatus.InProgress,
          statusMessage: `Account Assignment create operation is being processed`,
        });
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Account Assignment create operation is being processed`,
            requestId: requestId,
          }),
        };
      } else if (payload.action === "delete") {
        await s3clientObject.send(
          new DeleteObjectCommand({
            Bucket: artefactsBucketName,
            Key: `links_data/${linkData}`,
          })
        );
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
          handler: "userInterface-linkApi",
          logMode: "info",
          relatedData: linkData,
          requestId: requestId,
          hasRelatedRequests:
            linkData.split(delimeter)[0] === "account" ? false : true,
          status: requestStatus.InProgress,
          statusMessage: `Account Assignment delete operation is being processed`,
        });
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Account Assignment delete operation is being processed`,
            requestId: requestId,
          }),
        };
      } else {
        //TS flow path completion
        logger({
          handler: "userInterface-linkApi",
          logMode: "error",
          relatedData: linkData,
          requestId: requestId,
          status: requestStatus.FailedWithError,
          statusMessage: `Account Assignment operation cannot be processed due to invalid action`,
        });
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: "Invalid action provided",
          }),
        };
      }
    } catch (err) {
      if (err instanceof JSONParserError) {
        logger({
          handler: "userInterface-linkApi",
          logMode: "error",
          requestId: requestId,
          status: requestStatus.FailedWithException,
          statusMessage: `Error processing link operation through API interface due to schema errors for: ${JSON.stringify(
            err.errors
          )}`,
        });
        return {
          statusCode: 500,
          body: JSON.stringify({ errors: err.errors }),
        };
      } else {
        logger({
          handler: "userInterface-linkApi",
          logMode: "error",
          requestId: requestId,
          status: requestStatus.FailedWithException,
          statusMessage: `Error processing link operation through API interface due to schema errors for: ${JSON.stringify(
            err
          )}`,
        });
        return {
          statusCode: 500,
          body: JSON.stringify({
            message: `Exception while processing the call ${err}`,
          }),
        };
      }
    }
  } else {
    logger({
      handler: "userInterface-linkApi",
      logMode: "error",
      requestId: requestId,
      status: requestStatus.FailedWithException,
      statusMessage: `Invalid message body provided`,
    });
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Invalid message body provided",
      }),
    };
  }
};

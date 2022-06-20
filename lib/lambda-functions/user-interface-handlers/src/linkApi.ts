/**
 * Objective: Implement lambda proxy for link importer API Trigger source: link API
 *
 * - Schema validation of the payload
 * - Upsert / delete in links DDB table depending on the operation
 */

const {
  DdbTable,
  AWS_REGION,
  artefactsBucketName,
  linkProcessingTopicArn,
  functionLogMode,
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;

import {
  DynamoDBClient,
  DynamoDBServiceException,
} from "@aws-sdk/client-dynamodb";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import {
  PublishCommand,
  SNSClient,
  SNSServiceException,
} from "@aws-sdk/client-sns";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
import { v4 as uuidv4 } from "uuid";

import Ajv from "ajv";
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { readFileSync } from "fs";
import { join } from "path";
import {
  LinkData,
  LinkPayload,
  logModes,
  requestStatus,
} from "../../helpers/src/interfaces";
import {
  imperativeParseJSON,
  JSONParserError,
} from "../../helpers/src/payload-validator";
import {
  constructExceptionMessageforLogger,
  logger,
} from "../../helpers/src/utilities";

const ddbClientObject = new DynamoDBClient({
  region: AWS_REGION,
  maxAttempts: 2,
});
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const s3clientObject = new S3Client({ region: AWS_REGION, maxAttempts: 2 });
const snsClientObject = new SNSClient({ region: AWS_REGION, maxAttempts: 2 });
const ajv = new Ajv({ allErrors: true });
const schemaDefinition = JSON.parse(
  readFileSync(
    join("/opt", "nodejs", "payload-schema-definitions", "Link-API.json")
  )
    .valueOf()
    .toString()
);
const validate = ajv.compile(schemaDefinition);

const handlerName = AWS_LAMBDA_FUNCTION_NAME + "";
let linkDataValue = "";
export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const requestId = uuidv4().toString();
  logger(
    {
      handler: handlerName,
      logMode: logModes.Info,
      requestId: requestId,
      status: requestStatus.InProgress,
      statusMessage: `Account assignment create/delete operation started`,
    },
    functionLogMode
  );

  if (event.body !== null && event.body !== undefined) {
    try {
      const payload: LinkPayload = imperativeParseJSON(event.body, validate);
      logger(
        {
          handler: handlerName,
          logMode: logModes.Debug,
          requestId: requestId,
          status: requestStatus.InProgress,
          statusMessage: `Account assignment payload successfully parsed`,
        },
        functionLogMode
      );
      const delimeter = "%";
      const { linkData } = payload;
      linkDataValue = linkData;
      if (payload.action === "create") {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Account assignment operation is set as create`,
            relatedData: linkDataValue,
          },
          functionLogMode
        );

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
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Parsed individual entity details`,
            relatedData: linkDataValue,
            hasRelatedRequests:
              linkParams.awsEntityType === "account" ? false : true,
          },
          functionLogMode
        );

        await s3clientObject.send(
          new PutObjectCommand({
            Bucket: artefactsBucketName,
            Key: `links_data/${linkData}`,
            ServerSideEncryption: "AES256",
          })
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Processed upsert into S3`,
            relatedData: linkDataValue,
            hasRelatedRequests:
              linkParams.awsEntityType === "account" ? false : true,
          },
          functionLogMode
        );

        await ddbDocClientObject.send(
          new PutCommand({
            TableName: DdbTable,
            Item: {
              ...linkParams,
            },
          })
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Processed upsert into Dynamo DB`,
            relatedData: linkDataValue,
            hasRelatedRequests:
              linkParams.awsEntityType === "account" ? false : true,
          },
          functionLogMode
        );
        await snsClientObject.send(
          new PublishCommand({
            TopicArn: linkProcessingTopicArn + "",
            Message: JSON.stringify({
              linkData: linkDataValue,
              action: "create",
              requestId: requestId,
            }),
          })
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Account assignment create operation posted to link topic processor`,
            relatedData: linkDataValue,
            hasRelatedRequests:
              linkParams.awsEntityType === "account" ? false : true,
          },
          functionLogMode
        );
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Account Assignment create operation is being processed`,
            requestId: requestId,
          }),
        };
      } else if (payload.action === "delete") {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Info,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Account assignment operation is set as delete`,
            relatedData: linkDataValue,
            hasRelatedRequests:
              linkData.split(delimeter)[0] === "account" ? false : true,
          },
          functionLogMode
        );
        await s3clientObject.send(
          new DeleteObjectCommand({
            Bucket: artefactsBucketName,
            Key: `links_data/${linkData}`,
          })
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Processed upsert into S3`,
            relatedData: linkDataValue,
            hasRelatedRequests:
              linkData.split(delimeter)[0] === "account" ? false : true,
          },
          functionLogMode
        );
        await ddbDocClientObject.send(
          new DeleteCommand({
            TableName: DdbTable,
            Key: {
              awsEntityId: linkData,
            },
          })
        );
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Processed upsert into Dynamo DB`,
            relatedData: linkDataValue,
            hasRelatedRequests:
              linkData.split(delimeter)[0] === "account" ? false : true,
          },
          functionLogMode
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
        logger(
          {
            handler: handlerName,
            logMode: logModes.Debug,
            requestId: requestId,
            status: requestStatus.InProgress,
            statusMessage: `Account assignment delete operation posted to link processing topic`,
            relatedData: linkDataValue,
            hasRelatedRequests:
              linkData.split(delimeter)[0] === "account" ? false : true,
          },
          functionLogMode
        );
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Account Assignment delete operation is being processed`,
            requestId: requestId,
          }),
        };
      } else {
        logger(
          {
            handler: handlerName,
            logMode: logModes.Exception,
            requestId: requestId,
            status: requestStatus.FailedWithException,
            statusMessage: `Account assignment operation could not be completed due to invalid action`,
            relatedData: linkDataValue,
            hasRelatedRequests:
              linkData.split(delimeter)[0] === "account" ? false : true,
          },
          functionLogMode
        );
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
          handler: handlerName,
          requestId: requestId,
          logMode: logModes.Exception,
          status: requestStatus.FailedWithException,
          statusMessage: constructExceptionMessageforLogger(
            requestId,
            "Schema validation exception",
            `Provided account does not pass the schema validation`,
            JSON.stringify(err.errors)
          ),
        });
        return {
          statusCode: 500,
          body: JSON.stringify({
            message: constructExceptionMessageforLogger(
              requestId,
              "Schema validation exception",
              `Provided account does not pass the schema validation`,
              JSON.stringify(err.errors)
            ),
            requestId: requestId,
          }),
        };
      } else if (
        err instanceof DynamoDBServiceException ||
        err instanceof SNSServiceException ||
        err instanceof S3ServiceException
      ) {
        logger({
          handler: handlerName,
          requestId: requestId,
          logMode: logModes.Exception,
          status: requestStatus.FailedWithException,
          statusMessage: constructExceptionMessageforLogger(
            requestId,
            err.name,
            err.message,
            linkDataValue
          ),
        });
        return {
          statusCode: 500,
          body: JSON.stringify({
            message: constructExceptionMessageforLogger(
              requestId,
              err.name,
              err.message,
              linkDataValue
            ),
            requestId: requestId,
          }),
        };
      } else {
        logger({
          handler: handlerName,
          requestId: requestId,
          logMode: logModes.Exception,
          status: requestStatus.FailedWithException,
          statusMessage: constructExceptionMessageforLogger(
            requestId,
            "Unhandled exception",
            JSON.stringify(err),
            linkDataValue
          ),
        });
        return {
          statusCode: 500,
          body: JSON.stringify({
            message: constructExceptionMessageforLogger(
              requestId,
              "Unhandled exception",
              JSON.stringify(err),
              linkDataValue
            ),
            requestId: requestId,
          }),
        };
      }
    }
  } else {
    logger({
      handler: handlerName,
      requestId: requestId,
      logMode: logModes.Exception,
      status: requestStatus.FailedWithException,
      statusMessage: constructExceptionMessageforLogger(
        requestId,
        "Invalid message body exception",
        "Message body provided is invalid",
        linkDataValue
      ),
    });
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: constructExceptionMessageforLogger(
          requestId,
          "Invalid message body exception",
          "Message body provided is invalid",
          linkDataValue
        ),
        requestId: requestId,
      }),
    };
  }
};

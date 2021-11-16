/*
Objective: Implement lambda proxy for link importer API
Trigger source: link API
- Schema validation of the payload
- Upsert / delete in links DDB table depending on the operation
*/

// Environment configuration read
const { DdbTable, AWS_REGION, artefactsBucketName } = process.env;

// Lambda types import
// SDK and third party client imports
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  PutCommand,
} from "@aws-sdk/lib-dynamodb";
//Import validator function and dependencies
import Ajv from "ajv";
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { readFileSync } from "fs";
import { join } from "path";
import { LinkPayload } from "../../helpers/src/interfaces";
import {
  imperativeParseJSON,
  JSONParserError,
} from "../../helpers/src/payload-validator";

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const s3clientObject = new S3Client({ region: AWS_REGION });

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
  if (event.body !== null && event.body !== undefined) {
    try {
      const payload: LinkPayload = imperativeParseJSON(event.body, validate);
      const delimeter = ".";
      const { linkData } = payload;
      if (payload.action === "create") {
        const keyValue = linkData.split(delimeter);
        const linkParams = {
          awsEntityId: linkData,
          awsEntityType: keyValue[0],
          awsEntityData: keyValue[1],
          permissionSetName: keyValue[2],
          // Handle cases where groupName contains one or more delimeter characters
          groupName: keyValue.slice(3, -1).join(delimeter),
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
        console.log(
          `Procssed upsert of link data through API interface successfully: ${linkData}`
        );
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: "Successfully processed create link call",
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
        console.log(
          `Procssed deletion of link data through API interface successfully: ${linkData}`
        );
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: "Successfully processed delete link call",
          }),
        };
      } else {
        //TS flow path completion
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: "Invalid action provided",
          }),
        };
      }
    } catch (err) {
      if (err instanceof JSONParserError) {
        console.error(
          `Error processing link operation through API interface due to schema errors for: ${JSON.stringify(
            err.errors
          )}`
        );
        return {
          statusCode: 500,
          body: JSON.stringify({ errors: err.errors }),
        };
      } else {
        console.error(
          `Exception when processing linkAPI operation : ${JSON.stringify(err)}`
        );
        return {
          statusCode: 500,
          body: JSON.stringify({
            message: `Exception while processing the call ${err}`,
          }),
        };
      }
    }
  } else {
    console.error("Invalid message body provided");
    return {
      statusCode: 400,
      body: JSON.stringify({
        message: "Invalid message body provided",
      }),
    };
  }
};

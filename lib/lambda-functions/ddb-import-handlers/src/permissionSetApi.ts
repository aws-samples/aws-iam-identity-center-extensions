/*
Objective: Implement lambda proxy for permission set importer API
Trigger source: Permission set API
- Schema validation of the payload
- Upsert / delete in permission sets DDB table depending on the operation
*/

// Environment configuration read
const { linksTable, AWS_REGION, artefactsBucketName, DdbTable } = process.env;

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
  QueryCommand,
  QueryCommandOutput,
} from "@aws-sdk/lib-dynamodb";
//Import validator function and dependencies
import Ajv from "ajv";
import { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CreateUpdatePermissionSetPayload,
  DeletePermissionSetPayload,
} from "../../helpers/src/interfaces";
//Import helper utilities and interfaces
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
const createUpdateSchemaDefinition = JSON.parse(
  readFileSync(
    join(
      "/opt",
      "nodejs",
      "payload-schema-definitions",
      "PermissionSet-createUpdateAPI.json"
    )
  )
    .valueOf()
    .toString()
);
const createUpdateValidate = ajv.compile(createUpdateSchemaDefinition);
const deleteSchemaDefinition = JSON.parse(
  readFileSync(
    join(
      "/opt",
      "nodejs",
      "payload-schema-definitions",
      "PermissionSet-DeleteAPI.json"
    )
  )
    .valueOf()
    .toString()
);
const deleteValidate = ajv.compile(deleteSchemaDefinition);

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  if (event.body !== null && event.body !== undefined) {
    try {
      const body = JSON.parse(event.body);
      if (body.action === "create" || body.action === "update") {
        const payload = <CreateUpdatePermissionSetPayload>(
          imperativeParseJSON(event.body, createUpdateValidate)
        );
        await s3clientObject.send(
          new PutObjectCommand({
            Bucket: artefactsBucketName,
            Key: `permission_sets/${payload.permissionSetData.permissionSetName}.json`,
            Body: JSON.stringify(payload.permissionSetData),
            ServerSideEncryption: "AES256",
          })
        );
        await ddbDocClientObject.send(
          new PutCommand({
            TableName: DdbTable,
            Item: {
              ...payload.permissionSetData,
            },
          })
        );
        console.log(
          `processed upsert of permission set through API interface succesfully: ${payload.permissionSetData.permissionSetName}`
        );
        return {
          statusCode: 200,
          body: JSON.stringify({
            message: `Successfully invoked ${payload.action} permissionSet call`,
          }),
        };
      } else if (body.action === "delete") {
        const payload = <DeletePermissionSetPayload>(
          imperativeParseJSON(event.body, deleteValidate)
        );
        const relatedLinks: QueryCommandOutput = await ddbDocClientObject.send(
          // QueryCommand is a pagniated call, however the logic requires
          // checking only if the result set is greater than 0
          new QueryCommand({
            TableName: linksTable,
            IndexName: "permissionSetName",
            KeyConditionExpression: "#permissionSetName = :permissionSetName",
            ExpressionAttributeNames: {
              "#permissionSetName": "permissionSetName",
            },
            ExpressionAttributeValues: {
              ":permissionSetName": payload.permissionSetData.permissionSetName,
            },
          })
        );

        if (relatedLinks.Items?.length !== 0) {
          console.log(
            `Cannot delete permissionSet as there are existing links referencing the permission set: ${payload.permissionSetData.permissionSetName}`
          );
          return {
            statusCode: 400,
            body: JSON.stringify({
              message:
                "Cannot delete the permission set due to existing links referencing the permission set",
            }),
          };
        } else {
          await s3clientObject.send(
            new DeleteObjectCommand({
              Bucket: artefactsBucketName,
              Key: `permission_sets/${payload.permissionSetData.permissionSetName}.json`,
            })
          );
          await ddbDocClientObject.send(
            new DeleteCommand({
              TableName: DdbTable,
              Key: {
                permissionSetName: payload.permissionSetData.permissionSetName,
              },
            })
          );
          console.log(
            `processed deletion of permission set through API interface succesfully: ${payload.permissionSetData.permissionSetName}`
          );
          return {
            statusCode: 200,
            body: JSON.stringify({
              message: "Successfully invoked delete permissionSet call",
            }),
          };
        }
      } else {
        return {
          statusCode: 400,
          body: JSON.stringify({
            message: `Invalid action type provided ${body.action}`,
          }),
        };
      }
    } catch (err) {
      if (err instanceof JSONParserError) {
        console.error(
          `Error processing permissionset operation through API interface due to schema errors for: ${JSON.stringify(
            err.errors
          )}`
        );
        return {
          statusCode: 400,
          body: JSON.stringify({ errors: err.errors }),
        };
      } else {
        console.error(
          `Exception when processing linkAPI operation : ${JSON.stringify(err)}`
        );
        return {
          statusCode: 400,
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

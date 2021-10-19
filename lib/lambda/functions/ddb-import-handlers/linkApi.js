/*
Objective: Implement lambda proxy for link importer API
Trigger source: link API
- Schema validation of the payload
- Upsert / delete in links DDB table depending on the operation
*/

// Environment configuration read
const {
  corsOrigin, DdbTable, AWS_REGION, artefactsBucketName,
} = process.env;

// SDK and third party client imports
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  DeleteCommand,
} = require('@aws-sdk/lib-dynamodb');
const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const { Validator } = require('jsonschema');

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const s3clientObject = new S3Client({ region: AWS_REGION });
const validatorObject = new Validator();

// Schema definition for linkAPI payload validation
const linkApiSchema = {
  schema: 'http://json-schema.org/draft-07/schema',
  id: 'Link-API',
  type: 'object',
  title: 'Link-API',
  description: 'Schemea for link create/delete.',
  default: {},
  required: ['action', 'linkData'],
  properties: {
    action: {
      id: '#/properties/action',
      type: 'string',
      title: 'Link operation type',
      description: 'Link operation type',
      default: '',
      enum: ['create', 'delete'],
    },
    linkData: {
      id: '#/properties/linkData',
      type: 'string',
      title: 'Link ojbect',
      description: 'Link object',
      default: {},
      oneOf: [
        { pattern: 'root.all.[\\w+=,.@-]{1,32}.[a-zA-Z0-9-_@.\\s]+.ssofile' },
        {
          pattern:
            'ou_id.ou-[a-z0-9]{4}-[a-z0-9]{8}.[\\w+=,.@-]{1,32}.[a-zA-Z0-9-_@.\\s]+.ssofile',
        },
        {
          pattern:
            'account.[0-9]{12}.[\\w+=,.@-]{1,32}.[a-zA-Z0-9-_@.\\s]+.ssofile',
        },
        {
          pattern:
            'account_tag.[\\w+=,.@-]{1,128}\\^[\\w+=,.@-]{1,256}.[\\w+=,.@-]{1,32}.[a-zA-Z0-9-_@.\\s]+.ssofile',
        },
      ],
    },
  },
  additionalProperties: false,
};

exports.handler = async (event) => {
  const response = {
    headers: {
      'Access-Control-Allow-Origin': corsOrigin,
      'Access-Control-Allow-Credentials': true,
      'Access-Control-Allow-Headers':
        'Content-Type, X-Amz-Date, X-Amz-Security-Token, Authorization, X-Api-Key, X-Requested-With, Accept, Access-Control-Allow-Methods, Access-Control-Allow-Origin, Access-Control-Allow-Headers',
      'Access-Control-Allow-Methods': 'OPTIONS, POST',
    },
  };

  if (event.body !== null && event.body !== undefined) {
    try {
      const body = JSON.parse(event.body);

      if (validatorObject.validate(body, linkApiSchema).valid) {
        const delimeter = '.';
        const { linkData } = body;
        if (body.action === 'create') {
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
              ServerSideEncryption: 'AES256',
            }),
          );
          await ddbDocClientObject.send(
            new PutCommand({
              TableName: DdbTable,
              Item: {
                ...linkParams,
              },
            }),
          );
          console.log(
            `Procssed upsert of link data through API interface successfully: ${linkData}`,
          );
          response.statusCode = '200';
          response.body = JSON.stringify({
            message: 'Successfully processed create link call',
          });
          return response;
        }
        if (body.action === 'delete') {
          await s3clientObject.send(
            new DeleteObjectCommand({
              Bucket: artefactsBucketName,
              Key: `links_data/${linkData}`,
            }),
          );
          await ddbDocClientObject.send(
            new DeleteCommand({
              TableName: DdbTable,
              Key: {
                awsEntityId: linkData,
              },
            }),
          );
          console.log(
            `Procssed deletion of link data through API interface successfully: ${linkData}`,
          );
          response.statusCode = '200';
          response.body = JSON.stringify({
            message: 'Successfully processed delete link call',
          });
          return response;
        }
        response.statusCode = '400';
        response.body = JSON.stringify({
          message: `Unsupported action provided ${body.action}`,
        });
        return response;
      }

      response.statusCode = '400';
      const errorDetails = validatorObject.validate(body, linkApiSchema);
      response.body = JSON.stringify({
        message: `Invalid action/link data provided: ${errorDetails}`,
      });
      return response;
    } catch (err) {
      response.statusCode = '400';
      response.body = JSON.stringify({
        message: `Error processing the call ${err}`,
      });
      return response;
    }
  } else {
    response.statusCode = '400';
    response.body = JSON.stringify({
      message: `Invalid message body provided: ${event.body}`,
    });
    return response;
  }
};

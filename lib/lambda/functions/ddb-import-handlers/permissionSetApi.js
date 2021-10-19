/*
Objective: Implement lambda proxy for permission set importer API
Trigger source: Permission set API
- Schema validation of the payload
- Upsert / delete in permission sets DDB table depending on the operation
*/

// Environment configuration read
const {
  linksTable, corsOrigin, AWS_REGION, artefactsBucketName, DdbTable,
} = process.env;

// SDK and third party client imports
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
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

const createUpdateSchema = {
  schema: 'http://json-schema.org/draft-07/schema',
  id: 'PermissionSet-CreateUpdate',
  type: 'object',
  title: 'PermissionSet-CreateUpdate',
  description: 'Schemea for permission set create/update payload.',
  default: {},
  required: ['action', 'permissionSetData'],
  properties: {
    action: {
      id: '#/properties/action',
      type: 'string',
      title: 'Permission set operation type',
      description: 'Permission set operation type',
      default: '',
      enum: ['create', 'update'],
    },
    permissionSetData: {
      id: '#/properties/permissionSetData',
      type: 'object',
      title: 'Permission Set Object',
      description: 'Permission Set Object',
      default: {},
      required: [
        'permissionSetName',
        'sessionDurationInMinutes',
        'relayState',
        'tags',
        'managedPoliciesArnList',
        'inlinePolicyDocument',
      ],
      properties: {
        permissionSetName: {
          id: '#/properties/permissionSetData/properties/permissionSetName',
          type: 'string',
          title: 'Permission Set Name',
          description: 'Permission Set Nam',
          default: '',
          minLength: 1,
          maxLength: 32,
          pattern: '^([\\w+=,.@-]+)$',
        },
        sessionDurationInMinutes: {
          id: '#/properties/permissionSetData/properties/sessionDurationInMinutes',
          type: 'string',
          title: 'sessionDurationInMinutes',
          description: 'sessionDurationInMinutes',
          default: '',
          minLength: 0,
          pattern: '^(720|7[0-1][0-9]|[1-6][0-9][0-9]|[6-9][0-9])$',
        },
        relayState: {
          id: '#/properties/permissionSetData/properties/relayState',
          type: 'string',
          title: 'relayState',
          description: 'relayState',
          default: '',
          minLength: 0,
          maxLength: 240,
        },
        tags: {
          id: '#/properties/permissionSetData/properties/tags',
          type: 'array',
          title: 'tags',
          description: 'tags',
          default: [],
          additionalItems: true,
          items: {
            id: '#/properties/permissionSetData/properties/tags/items',
            anyOf: [
              {
                id: '#/properties/permissionSetData/properties/tags/items/anyOf/0',
                type: 'object',
                title: 'tag object',
                description: 'tag object',
                default: {},
                required: ['Key', 'Value'],
                properties: {
                  Key: {
                    id: '#/properties/permissionSetData/properties/tags/items/anyOf/0/properties/Key',
                    type: 'string',
                    title: 'tag object key',
                    description: 'tag object key',
                    default: '',
                    minLength: 1,
                    maxLength: 128,
                    pattern: '^[A-Za-z0-9_:/=\\+\\-@]*$',
                  },
                  Value: {
                    id: '#/properties/permissionSetData/properties/tags/items/anyOf/0/properties/Value',
                    type: 'string',
                    title: 'tag object value',
                    description: 'tag object value',
                    default: '',
                    minLength: 0,
                    maxLength: 256,
                    pattern: '^[A-Za-z0-9_:/=\\+\\-@]*$',
                  },
                },
                additionalProperties: false,
              },
            ],
          },
        },
        managedPoliciesArnList: {
          id: '#/properties/permissionSetData/properties/managedPoliciesArnList',
          type: 'array',
          title: 'The managedPoliciesArnList schema',
          description: 'An explanation about the purpose of this instance.',
          default: [],
          additionalItems: true,
          items: {
            id: '#/properties/permissionSetData/properties/managedPoliciesArnList/items',
            anyOf: [
              {
                id: '#/properties/permissionSetData/properties/managedPoliciesArnList/items/anyOf/0',
                type: 'string',
                title: 'Managed Policies schema',
                description: 'Managed Policies schema',
                default: '',
                pattern: 'arn:aws:iam::aws:policy/[A-Za-z]+',
              },
            ],
          },
        },
        inlinePolicyDocument: {
          id: '#/properties/permissionSetData/properties/inlinePolicyDocument',
          type: 'object',
          title: 'The inlinePolicyDocument schema',
          description: 'Inline Policy Document',
          default: {},
          properties: {
            Version: {
              id: '#/properties/permissionSetData/properties/inlinePolicyDocument/properties/Version',
              type: 'string',
              title: 'The Version schema',
              description: 'An explanation about the purpose of this instance.',
              default: '',
            },
            Statement: {
              id: '#/properties/permissionSetData/properties/inlinePolicyDocument/properties/Statement',
              type: 'array',
              title: 'The Statement schema',
              description: 'An explanation about the purpose of this instance.',
              default: [],
              additionalItems: true,
            },
          },
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const deleteSchema = {
  schema: 'http://json-schema.org/draft-07/schema',
  id: 'http://example.com/example.json',
  type: 'object',
  title: 'PostPayload',
  description: 'Schemea for permission set payload.',
  default: {},
  required: ['action', 'permissionSetData'],
  properties: {
    action: {
      id: '#/properties/action',
      type: 'string',
      title: 'Action schema',
      description: 'Permission set operation type',
      default: '',
      enum: ['delete'],
    },
    permissionSetData: {
      id: '#/properties/permissionSetData',
      type: 'object',
      title: 'The permissionSetData schema',
      description: 'Captures the complete permission set',
      default: {},
      required: ['permissionSetName'],
      properties: {
        permissionSetName: {
          id: '#/properties/permissionSetData/properties/permissionSetName',
          type: 'string',
          title: 'The permissionSetName schema',
          description: 'Name of the permission set name',
          default: '',
          minLength: 1,
          maxLength: 32,
          pattern: '^[a-zA-Z0-9-@=,s]*$',
        },
      },
      additionalProperties: false,
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

      let createUpdateValid = false;
      let deleteValid = false;

      createUpdateValid = validatorObject.validate(
        body,
        createUpdateSchema,
      ).valid;
      deleteValid = validatorObject.validate(body, deleteSchema).valid;

      if (createUpdateValid || deleteValid) {
        const { permissionSetData } = body;
        if (body.action === 'create' || body.action === 'update') {
          await s3clientObject.send(
            new PutObjectCommand({
              Bucket: artefactsBucketName,
              Key: `permission_sets/${permissionSetData.permissionSetName}.json`,
              Body: JSON.stringify(permissionSetData),
              ServerSideEncryption: 'AES256',
            }),
          );
          await ddbDocClientObject.send(
            new PutCommand({
              TableName: DdbTable,
              Item: {
                ...permissionSetData,
              },
            }),
          );
          console.log(
            `processed upsert of permission set through API interface succesfully: ${permissionSetData.permissionSetName}`,
          );
          response.statusCode = '200';
          response.body = JSON.stringify({
            message: `Successfully invoked ${body.action} permissionSet call`,
          });
          return response;
        }
        if (body.action === 'delete') {
          const realtedLinks = await ddbDocClientObject.send(
            // QueryCommand is a pagniated call, however the logic requires
            // checking only if the result set is greater than 0
            new QueryCommand({
              TableName: linksTable,
              IndexName: 'permissionSetName',
              KeyConditionExpression: '#permissionSetName = :permissionSetName',
              ExpressionAttributeNames: {
                '#permissionSetName': 'permissionSetName',
              },
              ExpressionAttributeValues: {
                ':permissionSetName': permissionSetData.permissionSetName,
              },
            }),
          );
          if (realtedLinks.Items.length !== 0) {
            console.log(
              `Cannot delete permissionSet as there are existing links referencing the permission set: ${permissionSetData.permissionSetName}`,
            );
            response.statusCode = '400';
            response.body = JSON.stringify({
              message:
                'Cannot delete the permission set due to existing links referencing the permission set',
            });
          } else {
            await s3clientObject.send(
              new DeleteObjectCommand({
                Bucket: artefactsBucketName,
                Key: `permission_sets/${permissionSetData.permissionSetName}.json`,
              }),
            );
            await ddbDocClientObject.send(
              new DeleteCommand({
                TableName: DdbTable,
                Key: {
                  permissionSetName: permissionSetData.permissionSetName,
                },
              }),
            );
            console.log(
              `processed deletion of permission set through API interface succesfully: ${permissionSetData.permissionSetName}`,
            );
            response.statusCode = '200';
            response.body = JSON.stringify({
              message: 'Successfully invoked delete permissionSet call',
            });
          }

          return response;
        }
        response.statusCode = '400';
        response.body = JSON.stringify({
          message: `Unsupported action provided ${body.action}`,
        });
        return response;
      }

      let errorDetails = '';
      if (!createUpdateValid) {
        errorDetails = validatorObject.validate(body, createUpdateSchema);
      } else if (!deleteValid) {
        errorDetails = validatorObject.validate(body, deleteSchema);
      }
      response.statusCode = '400';
      response.body = JSON.stringify({
        message: `Schema validation failed for the payload: ${errorDetails}`,
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

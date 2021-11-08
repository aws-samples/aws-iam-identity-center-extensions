/*
Objective: Implement event notification handler for permission set objects s3clientObject path
Trigger source: permission set s3clientObject path object notification for
both created and change type events
- Schema validation of the file name
- Upsert in permission set DDB table parsing the file name
*/

// Environment configuration read
const { DdbTable, errorNotificationsTopicArn, AWS_REGION } = process.env;

// SDK and third party client imports
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { SNSClient, PublishCommand } = require('@aws-sdk/client-sns');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

const { Validator } = require('jsonschema');

// SDK and third party client object initialistaion
const ddbClientObject = new DynamoDBClient({ region: AWS_REGION });
const ddbDocClientObject = DynamoDBDocumentClient.from(ddbClientObject);
const snsClientObject = new SNSClient({ region: AWS_REGION });
const s3clientObject = new S3Client({ region: AWS_REGION });
const validatorObject = new Validator();

const errorParams = {
  TopicArn: errorNotificationsTopicArn,
};
const errorMessage = {};

const createUpdateSchema = {
  schema: 'http://json-schema.org/draft-07/schema',
  id: 'permissionSetData',
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
      id: '#/properties/permissionSetName',
      type: 'string',
      title: 'Permission Set Name',
      description: 'Permission Set Nam',
      default: '',
      minLength: 1,
      maxLength: 32,
      pattern: '^([\\w+=,.@-]+)$',
    },
    sessionDurationInMinutes: {
      id: '#/properties/sessionDurationInMinutes',
      type: 'string',
      title: 'sessionDurationInMinutes',
      description: 'sessionDurationInMinutes',
      default: '',
      minLength: 0,
      pattern: '^(720|7[0-1][0-9]|[1-6][0-9][0-9]|[6-9][0-9])$',
    },
    relayState: {
      id: '#/properties/relayState',
      type: 'string',
      title: 'relayState',
      description: 'relayState',
      default: '',
      minLength: 0,
      maxLength: 240,
    },
    tags: {
      id: '#/properties/tags',
      type: 'array',
      title: 'tags',
      description: 'tags',
      default: [],
      additionalItems: true,
      items: {
        id: '#/properties/tags/items',
        anyOf: [
          {
            id: '#/properties/tags/items/anyOf/0',
            type: 'object',
            title: 'tag object',
            description: 'tag object',
            default: {},
            required: ['Key', 'Value'],
            properties: {
              Key: {
                id: '#/properties/tags/items/anyOf/0/properties/Key',
                type: 'string',
                title: 'tag object key',
                description: 'tag object key',
                default: '',
                minLength: 1,
                maxLength: 128,
                pattern: '^[A-Za-z0-9_:/=\\+\\-@]*$',
              },
              Value: {
                id: '#/properties/tags/items/anyOf/0/properties/Value',
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
      id: '#/properties/managedPoliciesArnList',
      type: 'array',
      title: 'The managedPoliciesArnList schema',
      description: 'An explanation about the purpose of this instance.',
      default: [],
      additionalItems: true,
      items: {
        id: '#/properties/managedPoliciesArnList/items',
        anyOf: [
          {
            id: '#/properties/managedPoliciesArnList/items/anyOf/0',
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
      id: '#/properties/inlinePolicyDocument',
      type: 'object',
      title: 'The inlinePolicyDocument schema',
      description: 'Inline Policy Document',
      default: {},
      properties: {
        Version: {
          id: '#/properties/inlinePolicyDocument/properties/Version',
          type: 'string',
          title: 'The Version schema',
          description: 'An explanation about the purpose of this instance.',
          default: '',
        },
        Statement: {
          id: '#/properties/inlinePolicyDocument/properties/Statement',
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
};

errorMessage.Subject = 'Error Processing Permission Set create/update via s3clientObject Interface';
// Load JSON data to DynamoDB table
const ddbLoader = async (passedData) => {
  const data = passedData;
  // Set up the params object for the DDB call
  for (const key of Object.keys(data)) {
    // An AttributeValue may not contain an empty string
    if (data[key] === '') delete data[key];
  }
  const params = {
    TableName: DdbTable,
    Item: {
      ...data,
    },
  };
  // Push to DynamoDB
  try {
    await ddbDocClientObject.send(new PutCommand(params));
  } catch (err) {
    console.error('Error in ddbLoader of permissionSetCU: ', err);
  }
};

// The Lambda handler
exports.handler = async (event) => {
  await Promise.all(
    event.Records.map(async (record) => {
      try {
        // Get original text from object in incoming event
        const originalText = await s3clientObject.send(
          new GetObjectCommand({
            Bucket: record.s3.bucket.name,
            Key: record.s3.object.key,
          }),
        );
        // Upload JSON to DynamoDB
        const jsonData = JSON.parse(originalText.Body.toString('utf-8'));

        if (validatorObject.validate(jsonData, createUpdateSchema).valid) {
          await ddbLoader(jsonData);
          console.log(
            `processed upsert of permission set through S3 interface succesfully: ${jsonData.permissionSetName}`,
          );
        } else {
          console.error(
            'Provided JSON schema is invalid , validation errors below: ',
          );
          const errorDetails = validatorObject.validate(
            jsonData,
            createUpdateSchema,
          );
          console.error(errorDetails);
          errorMessage.event_detail = event;
          errorMessage.error_details = errorDetails;
          errorParams.Message = JSON.stringify(errorMessage);
          await snsClientObject.send(new PublishCommand(errorParams));
        }
      } catch (err) {
        console.error('Main handler exception in permissionSetCu: ', err);
        errorMessage.event_detail = event;
        errorMessage.error_details = err;
        errorParams.Message = JSON.stringify(errorMessage);
        await snsClientObject.send(new PublishCommand(errorParams));
      }
    }),
  );
};

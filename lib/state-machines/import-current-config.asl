{
  "Comment": "Source state machine to handle importing existing SSO configuration data into the solution",
  "StartAt": "Check trigger source?",
  "States": {
    "Check trigger source?": {
      "Type": "Choice",
      "Choices": [
        {
          "And": [
            {
              "Variable": "$.eventType",
              "StringEquals": "Delete"
            },
            {
              "Variable": "$.triggerSource",
              "StringEquals": "CloudFormation"
            }
          ],
          "Next": "Pass"
        }
      ],
      "Default": "ListInstances"
    },
    "Pass": {
      "Type": "Pass",
      "End": true
    },
    "ListInstances": {
      "Type": "Task",
      "Next": "Create Temporary permission sets table",
      "Parameters": {},
      "Resource": "arn:aws:states:::aws-sdk:ssoadmin:listInstances",
      "ResultPath": "$.listInstancesResult",
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "BackoffRate": 1.5,
          "IntervalSeconds": 2,
          "MaxAttempts": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "Next": "Pass",
          "ResultPath": "$.stateMachineError"
        }
      ]
    },
    "Create Temporary permission sets table": {
      "Type": "Task",
      "Next": "Wait for temporary permission sets table creation",
      "Parameters": {
        "AttributeDefinitions": [
          {
            "AttributeName": "psArn",
            "AttributeType": "S"
          }
        ],
        "KeySchema": [
          {
            "AttributeName": "psArn",
            "KeyType": "HASH"
          }
        ],
        "TableName.$": "$.temporaryPermissionSetTableName",
        "BillingMode": "PAY_PER_REQUEST"
      },
      "Resource": "arn:aws:states:::aws-sdk:dynamodb:createTable",
      "ResultPath": "$.createPermissionSetsTableResult",
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "BackoffRate": 1.5,
          "IntervalSeconds": 2,
          "MaxAttempts": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "Next": "Pass",
          "ResultPath": "$.stateMachineError"
        }
      ]
    },
    "Wait for temporary permission sets table creation": {
      "Type": "Wait",
      "SecondsPath": "$.waitSeconds",
      "Next": "Get temporary permission set table creation status"
    },
    "Get temporary permission set table creation status": {
      "Type": "Task",
      "Next": "Verify if temporary permission sets table is created",
      "Parameters": {
        "TableName.$": "$.temporaryPermissionSetTableName"
      },
      "Resource": "arn:aws:states:::aws-sdk:dynamodb:describeTable",
      "ResultPath": "$.describeTemporaryPermissionSetsTableResult",
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "BackoffRate": 1.5,
          "IntervalSeconds": 2,
          "MaxAttempts": 2
        }
      ],
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "Next": "Delete temporary permission sets table",
          "ResultPath": "$.stateMachineError"
        }
      ]
    },
    "Verify if temporary permission sets table is created": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.describeTemporaryPermissionSetsTableResult.Table.TableStatus",
          "StringEquals": "ACTIVE",
          "Next": "Trigger Import Permission Set state machine"
        }
      ],
      "Default": "Repeat wait loop until permission set table is created"
    },
    "Repeat wait loop until permission set table is created": {
      "Type": "Wait",
      "SecondsPath": "$.waitSeconds",
      "Next": "Get temporary permission set table creation status"
    },
    "Trigger Import Permission Set state machine": {
      "Type": "Task",
      "Resource": "arn:aws:states:::states:startExecution.sync:2",
      "Parameters": {
        "StateMachineArn.$": "$.importPermissionSetSMArn",
        "Input": {
          "AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID.$": "$$.Execution.Id",
          "instanceArn.$": "$.listInstancesResult.Instances[0].InstanceArn",
          "identityStoreId.$": "$.listInstancesResult.Instances[0].IdentityStoreId",
          "ps-importTopicArn.$": "$.permissionSetImportTopicArn",
          "ps-tableName.$": "$.temporaryPermissionSetTableName",
          "accounts-stateMachineArn.$": "$.importAccountAssignmentSMArn",
          "accounts-importTopicArn.$": "$.accountAssignmentImportTopicArn",
          "requestId.$": "$.requestId",
          "triggerSource.$": "$.triggerSource",
          "waitSeconds.$": "$.waitSeconds",
          "pageSize.$": "$.pageSize"
        }
      },
      "Next": "Delete temporary permission sets table",
      "ResultPath": null,
      "Catch": [
        {
          "ErrorEquals": [
            "States.ALL"
          ],
          "Next": "Delete temporary permission sets table",
          "ResultPath": "$.stateMachineError"
        }
      ]
    },
    "Delete temporary permission sets table": {
      "Type": "Task",
      "Parameters": {
        "TableName.$": "$.temporaryPermissionSetTableName"
      },
      "Resource": "arn:aws:states:::aws-sdk:dynamodb:deleteTable",
      "ResultPath": null,
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "BackoffRate": 1.5,
          "IntervalSeconds": 2,
          "MaxAttempts": 2
        }
      ],
      "End": true
    }
  }
}
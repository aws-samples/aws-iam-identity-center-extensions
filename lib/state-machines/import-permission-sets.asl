{
  "Comment": "Handle import of permission sets created outside the solution",
  "StartAt": "ListPermissionSets",
  "States": {
    "ListPermissionSets": {
      "Type": "Task",
      "Parameters": {
        "InstanceArn.$": "$.instanceArn",
        "MaxResults.$": "$.pageSize"
      },
      "Resource": "arn:aws:states:::aws-sdk:ssoadmin:listPermissionSets",
      "Next": "Loop through permission sets",
      "ResultPath": "$.listPermissionSets",
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "BackoffRate": 1.5,
          "IntervalSeconds": 2,
          "MaxAttempts": 2
        }
      ]
    },
    "Loop through permission sets": {
      "Type": "Map",
      "Iterator": {
        "StartAt": "DescribePermissionSet",
        "States": {
          "DescribePermissionSet": {
            "Type": "Task",
            "Parameters": {
              "InstanceArn.$": "$.instanceArn",
              "PermissionSetArn.$": "$.permissionSetArn"
            },
            "Resource": "arn:aws:states:::aws-sdk:ssoadmin:describePermissionSet",
            "Next": "Put Permission Set",
            "ResultPath": "$.describePermissionSet",
            "Retry": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "BackoffRate": 1.5,
                "IntervalSeconds": 2,
                "MaxAttempts": 2
              }
            ]
          },
          "Put Permission Set": {
            "Type": "Task",
            "Resource": "arn:aws:states:::dynamodb:putItem",
            "Parameters": {
              "TableName.$": "$.ps-tableName",
              "Item": {
                "psArn": {
                  "S.$": "$.permissionSetArn"
                }
              }
            },
            "Next": "ListManagedPoliciesInPermissionSet",
            "ResultPath": null,
            "Retry": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "BackoffRate": 1.5,
                "IntervalSeconds": 2,
                "MaxAttempts": 2
              }
            ]
          },
          "ListManagedPoliciesInPermissionSet": {
            "Type": "Task",
            "Parameters": {
              "InstanceArn.$": "$.instanceArn",
              "PermissionSetArn.$": "$.permissionSetArn",
              "MaxResults.$": "$.pageSize"
            },
            "Resource": "arn:aws:states:::aws-sdk:ssoadmin:listManagedPoliciesInPermissionSet",
            "ResultPath": "$.listManagedPoliciesInPermissionSet",
            "Next": "Process Managed Policies update",
            "Retry": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "BackoffRate": 1.5,
                "IntervalSeconds": 2,
                "MaxAttempts": 2
              }
            ]
          },
          "Process Managed Policies update": {
            "Type": "Map",
            "Next": "Are there more managed policies?",
            "Iterator": {
              "StartAt": "Add Managed Policies to the PS",
              "States": {
                "Add Managed Policies to the PS": {
                  "Type": "Task",
                  "Resource": "arn:aws:states:::dynamodb:updateItem",
                  "Parameters": {
                    "TableName.$": "$.ps-tableName",
                    "Key": {
                      "psArn": {
                        "S.$": "$.permissionSetArn"
                      }
                    },
                    "UpdateExpression": "ADD managedPoliciesList :mpList",
                    "ExpressionAttributeValues": {
                      ":mpList": {
                        "SS.$": "States.Array($.mp)"
                      }
                    }
                  },
                  "ResultPath": "$.addManagedPoliciesResult",
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
            },
            "ItemsPath": "$.listManagedPoliciesInPermissionSet.AttachedManagedPolicies",
            "Parameters": {
              "ps-tableName.$": "$.ps-tableName",
              "permissionSetArn.$": "$.permissionSetArn",
              "mp.$": "$$.Map.Item.Value.Arn"
            },
            "ResultPath": null
          },
          "Are there more managed policies?": {
            "Type": "Choice",
            "Choices": [
              {
                "Variable": "$.listManagedPoliciesInPermissionSet.NextToken",
                "IsPresent": true,
                "Next": "ListManagedPoliciesInPermissionSet with NextToken"
              }
            ],
            "Default": "GetInlinePolicyForPermissionSet"
          },
          "ListManagedPoliciesInPermissionSet with NextToken": {
            "Type": "Task",
            "Parameters": {
              "InstanceArn.$": "$.instanceArn",
              "PermissionSetArn.$": "$.permissionSetArn",
              "MaxResults.$": "$.pageSize",
              "NextToken.$": "$.listManagedPoliciesInPermissionSet.NextToken"
            },
            "Resource": "arn:aws:states:::aws-sdk:ssoadmin:listManagedPoliciesInPermissionSet",
            "Next": "Process Managed Policies update",
            "ResultPath": "$.listManagedPoliciesInPermissionSet",
            "Retry": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "BackoffRate": 1.5,
                "IntervalSeconds": 2,
                "MaxAttempts": 2
              }
            ]
          },
          "GetInlinePolicyForPermissionSet": {
            "Type": "Task",
            "Parameters": {
              "InstanceArn.$": "$.instanceArn",
              "PermissionSetArn.$": "$.permissionSetArn"
            },
            "Resource": "arn:aws:states:::aws-sdk:ssoadmin:getInlinePolicyForPermissionSet",
            "ResultPath": "$.getInlinePolicyForPermissionSet",
            "Next": "ListTagsForResource",
            "Retry": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "BackoffRate": 1.5,
                "IntervalSeconds": 2,
                "MaxAttempts": 2
              }
            ]
          },
          "ListTagsForResource": {
            "Type": "Task",
            "Parameters": {
              "InstanceArn.$": "$.instanceArn",
              "ResourceArn.$": "$.permissionSetArn"
            },
            "Resource": "arn:aws:states:::aws-sdk:ssoadmin:listTagsForResource",
            "ResultPath": "$.listTagsForResource",
            "Next": "Process through tag Values",
            "Retry": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "BackoffRate": 1.5,
                "IntervalSeconds": 2,
                "MaxAttempts": 2
              }
            ]
          },
          "Process through tag Values": {
            "Type": "Map",
            "Next": "Are there more Tags?",
            "Iterator": {
              "StartAt": "Add Tags to the PS",
              "States": {
                "Add Tags to the PS": {
                  "Type": "Task",
                  "Resource": "arn:aws:states:::dynamodb:updateItem",
                  "Parameters": {
                    "TableName.$": "$.ps-tableName",
                    "Key": {
                      "psArn": {
                        "S.$": "$.permissionSetArn"
                      }
                    },
                    "UpdateExpression": "ADD tags :tagsList",
                    "ExpressionAttributeValues": {
                      ":tagsList": {
                        "SS.$": "States.Array(States.JsonToString($.tag))"
                      }
                    }
                  },
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
            },
            "ItemsPath": "$.listTagsForResource.Tags",
            "ResultPath": null,
            "Parameters": {
              "ps-tableName.$": "$.ps-tableName",
              "permissionSetArn.$": "$.permissionSetArn",
              "tag.$": "$$.Map.Item.Value"
            }
          },
          "Are there more Tags?": {
            "Type": "Choice",
            "Choices": [
              {
                "Variable": "$.listTagsForResource.NextToken",
                "IsPresent": true,
                "Next": "ListTagsForResource with NextToken"
              }
            ],
            "Default": "Fetch Permission Set"
          },
          "Fetch Permission Set": {
            "Type": "Task",
            "Resource": "arn:aws:states:::dynamodb:getItem",
            "Parameters": {
              "TableName.$": "$.ps-tableName",
              "Key": {
                "psArn": {
                  "S.$": "$.permissionSetArn"
                }
              }
            },
            "Next": "Publish to PS import handling topic",
            "ResultPath": "$.fetchPermissionSetResult",
            "Retry": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "BackoffRate": 1.5,
                "IntervalSeconds": 2,
                "MaxAttempts": 2
              }
            ]
          },
          "ListTagsForResource with NextToken": {
            "Type": "Task",
            "Parameters": {
              "InstanceArn.$": "$.instanceArn",
              "ResourceArn.$": "$.permissionSetArn",
              "NextToken.$": "$.listTagsForResource.NextToken"
            },
            "Resource": "arn:aws:states:::aws-sdk:ssoadmin:listTagsForResource",
            "ResultPath": "$.listTagsForResource",
            "Next": "Process through tag Values",
            "Retry": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "BackoffRate": 1.5,
                "IntervalSeconds": 2,
                "MaxAttempts": 2
              }
            ]
          },
          "Publish to PS import handling topic": {
            "Type": "Task",
            "Resource": "arn:aws:states:::sns:publish",
            "Parameters": {
              "TopicArn.$": "$.topicArn",
              "Message.$": "$"
            },
            "Next": "Delete Permission Set",
            "Retry": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "BackoffRate": 1.5,
                "IntervalSeconds": 2,
                "MaxAttempts": 2
              }
            ],
            "ResultPath": null
          },
          "Delete Permission Set": {
            "Type": "Task",
            "Resource": "arn:aws:states:::dynamodb:deleteItem",
            "Parameters": {
              "TableName.$": "$.ps-tableName",
              "Key": {
                "psArn": {
                  "S.$": "$.permissionSetArn"
                }
              }
            },
            "Next": "ListAccountsForProvisionedPermissionSet",
            "ResultPath": null,
            "Retry": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "BackoffRate": 1.5,
                "IntervalSeconds": 2,
                "MaxAttempts": 2
              }
            ]
          },
          "ListAccountsForProvisionedPermissionSet": {
            "Type": "Task",
            "Parameters": {
              "InstanceArn.$": "$.instanceArn",
              "PermissionSetArn.$": "$.permissionSetArn",
              "ProvisioningStatus": "LATEST_PERMISSION_SET_PROVISIONED",
              "MaxResults.$": "$.pageSize"
            },
            "Resource": "arn:aws:states:::aws-sdk:ssoadmin:listAccountsForProvisionedPermissionSet",
            "ResultPath": "$.listAccountsForProvisionedPermissionSet",
            "Next": "Loop through account ID list",
            "Retry": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "BackoffRate": 1.5,
                "IntervalSeconds": 2,
                "MaxAttempts": 2
              }
            ]
          },
          "Loop through account ID list": {
            "Type": "Map",
            "Iterator": {
              "StartAt": "Trigger Import Account Assignment State Machine",
              "States": {
                "Trigger Import Account Assignment State Machine": {
                  "Type": "Task",
                  "Resource": "arn:aws:states:::states:startExecution.sync:2",
                  "Parameters": {
                    "StateMachineArn.$": "$.accounts-stateMachineArn",
                    "Input": {
                      "instanceArn.$": "$.instanceArn",
                      "identityStoreId.$": "$.identityStoreId",
                      "accountId.$": "$.accountId",
                      "permissionSetArn.$": "$.permissionSetArn",
                      "accounts-importTopicArn.$": "$.accounts-importTopicArn",
                      "AWS_STEP_FUNCTIONS_STARTED_BY_EXECUTION_ID.$": "$$.Execution.Id",
                      "permissionSetName.$": "$.permissionSetName",
                      "requestId.$": "$.requestId",
                      "triggerSource.$": "$.triggerSource",
                      "waitSeconds.$": "$.waitSeconds",
                      "pageSize.$": "$.pageSize"
                    }
                  },
                  "End": true
                }
              }
            },
            "ItemsPath": "$.listAccountsForProvisionedPermissionSet.AccountIds",
            "Next": "Check for NextToken in listAccountsForProvisionedPermissionSet call",
            "Parameters": {
              "instanceArn.$": "$.instanceArn",
              "identityStoreId.$": "$.identityStoreId",
              "accountId.$": "$$.Map.Item.Value",
              "permissionSetArn.$": "$.permissionSetArn",
              "accounts-stateMachineArn.$": "$.accounts-stateMachineArn",
              "accounts-importTopicArn.$": "$.accounts-importTopicArn",
              "permissionSetName.$": "$.describePermissionSet.PermissionSet.Name",
              "requestId.$": "$.requestId",
              "triggerSource.$": "$.triggerSource",
              "waitSeconds.$": "$.waitSeconds",
              "pageSize.$": "$.pageSize"
            },
            "ResultPath": null
          },
          "Check for NextToken in listAccountsForProvisionedPermissionSet call": {
            "Type": "Choice",
            "Choices": [
              {
                "Variable": "$.listAccountsForProvisionedPermissionSet.NextToken",
                "IsPresent": true,
                "Next": "Wait for Identity Store Throttle"
              }
            ],
            "Default": "Pass through"
          },
          "Wait for Identity Store Throttle": {
            "Type": "Wait",
            "Next": "ListAccountsForProvisionedPermissionSet with NextToken",
            "SecondsPath": "$.waitSeconds"
          },
          "ListAccountsForProvisionedPermissionSet with NextToken": {
            "Type": "Task",
            "Parameters": {
              "InstanceArn.$": "$.instanceArn",
              "PermissionSetArn.$": "$.permissionSetArn",
              "ProvisioningStatus": "LATEST_PERMISSION_SET_PROVISIONED",
              "NextToken.$": "$.listAccountsForProvisionedPermissionSet.NextToken",
              "MaxResults.$": "$.pageSize"
            },
            "Resource": "arn:aws:states:::aws-sdk:ssoadmin:listAccountsForProvisionedPermissionSet",
            "Next": "Loop through account ID list",
            "ResultPath": "$.listAccountsForProvisionedPermissionSet",
            "Retry": [
              {
                "ErrorEquals": ["States.TaskFailed"],
                "BackoffRate": 1.5,
                "IntervalSeconds": 2,
                "MaxAttempts": 2
              }
            ]
          },
          "Pass through": {
            "Type": "Pass",
            "End": true
          }
        }
      },
      "ItemsPath": "$.listPermissionSets.PermissionSets",
      "Next": "Check for NextToken in ListPermissionSets call",
      "Parameters": {
        "instanceArn.$": "$.instanceArn",
        "identityStoreId.$": "$.identityStoreId",
        "topicArn.$": "$.ps-importTopicArn",
        "ps-tableName.$": "$.ps-tableName",
        "permissionSetArn.$": "$$.Map.Item.Value",
        "accounts-stateMachineArn.$": "$.accounts-stateMachineArn",
        "accounts-importTopicArn.$": "$.accounts-importTopicArn",
        "requestId.$": "$.requestId",
        "triggerSource.$": "$.triggerSource",
        "waitSeconds.$": "$.waitSeconds",
        "pageSize.$": "$.pageSize"
      },
      "ResultPath": null
    },
    "Check for NextToken in ListPermissionSets call": {
      "Type": "Choice",
      "Choices": [
        {
          "Variable": "$.listPermissionSets.NextToken",
          "IsPresent": true,
          "Next": "Wait for SSO Admin throttle"
        }
      ],
      "Default": "Pass"
    },
    "Wait for SSO Admin throttle": {
      "Type": "Wait",
      "Next": "ListPermissionSets with NextToken",
      "SecondsPath": "$.waitSeconds"
    },
    "ListPermissionSets with NextToken": {
      "Type": "Task",
      "Parameters": {
        "InstanceArn.$": "$.instanceArn",
        "MaxResults.$": "$.pageSize",
        "NextToken.$": "$.listPermissionSets.NextToken"
      },
      "Resource": "arn:aws:states:::aws-sdk:ssoadmin:listPermissionSets",
      "Next": "Loop through permission sets",
      "ResultPath": "$.listPermissionSets",
      "Retry": [
        {
          "ErrorEquals": ["States.TaskFailed"],
          "BackoffRate": 1.5,
          "IntervalSeconds": 2,
          "MaxAttempts": 2
        }
      ]
    },
    "Pass": {
      "Type": "Pass",
      "End": true
    }
  }
}
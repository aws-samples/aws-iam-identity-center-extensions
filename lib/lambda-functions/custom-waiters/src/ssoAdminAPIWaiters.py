# Objective: Implement custom waiter logic for resolving success/failure status of asynchronous operations
# Trigger source: Waiter Handler SNS topic
# Operations handled: DescribePermissionSetProvisioningStatus , DescribeAccountAssignmentCreationStatus, DescribeAccountAssignmentDeletionStatus
# DescribePermissionSetProvisioningStatus success, do nothing . DescribePermissionSetProvisioningStatus failure , send error details to error notification topic
# DescribeAccountAssignmentCreationStatus success, upsert item into provisioned links table .DescribeAccountAssignmentCreationStatus failure, send error details to error notification topic
# DescribeAccountAssignmentDeletionStatus success, delete item from provisioned links table .DescribeAccountAssignmentCreationStatus failure, send error details to error notification topic
from __future__ import print_function

import json
import logging
import os
import traceback
import boto3
from botocore.exceptions import ClientError, WaiterError
from botocore.waiter import WaiterModel, create_waiter_with_client

logger = logging.getLogger()
logger.setLevel(logging.INFO)

error_notifications_topic_arn = os.environ['errorNotificationsTopicArn']
sso_api_rolearn = os.environ['SSOAPIRoleArn']
sso_service_region = os.environ['SSOServiceAccountRegion']

sts_client = boto3.client('sts')
assumed_role_object = sts_client.assume_role(
    RoleArn=sso_api_rolearn,
    RoleSessionName='waiterHandler'
)
assumed_role_credentials = assumed_role_object['Credentials']
assumed_role_session = boto3.session.Session(
    aws_access_key_id=assumed_role_credentials['AccessKeyId'],
    aws_secret_access_key=assumed_role_credentials['SecretAccessKey'],
    aws_session_token=assumed_role_credentials['SessionToken'],
    region_name=sso_service_region
)
sso_admin_client = assumed_role_session.client('sso-admin')

dynamodb_resource = boto3.resource('dynamodb')
provisionedLinksTable = dynamodb_resource.Table(
    os.environ['provisionedLinksTable'])
sns_client = boto3.client('sns')
delay = 10
max_attempts = 3
errorMessage = {}
permissionset_waiter_name = 'PermissionSetProvisioned'
permission_set_status = 'PermissionSetProvisioningStatus.Status'
permissionset_waiter_config = {
    'version': 2,
    'waiters': {
        'PermissionSetProvisioned': {
            'operation': 'DescribePermissionSetProvisioningStatus',
            'delay': delay,
            'maxAttempts': max_attempts,
            'acceptors': [
                {
                    "matcher": "path",
                    "expected": "SUCCEEDED",
                    "argument": permission_set_status,
                    "state": "success"
                },
                {
                    "matcher": "path",
                    "expected": "IN_PROGRESS",
                    "argument": permission_set_status,
                    "state": "retry"
                },
                {
                    "matcher": "path",
                    "expected": "FAILED",
                    "argument": permission_set_status,
                    "state": "failure"
                }
            ],
        },
    },
}
permissionset_waiter_model = WaiterModel(permissionset_waiter_config)
permissionset_waiter = create_waiter_with_client(
    permissionset_waiter_name, permissionset_waiter_model, sso_admin_client)
createAccountAssignment_waiter_name = 'AccountAssignmentCreated'
createAccountAssignment_creation_status = 'AccountAssignmentCreationStatus.Status'
createAccountAssignment_waiter_config = {
    'version': 2,
    'waiters': {
        'AccountAssignmentCreated': {
            'operation': 'DescribeAccountAssignmentCreationStatus',
            'delay': delay,
            'maxAttempts': max_attempts,
            'acceptors': [
                {
                    "matcher": "path",
                    "expected": "SUCCEEDED",
                    "argument": createAccountAssignment_creation_status,
                    "state": "success"
                },
                {
                    "matcher": "path",
                    "expected": "IN_PROGRESS",
                    "argument": createAccountAssignment_creation_status,
                    "state": "retry"
                },
                {
                    "matcher": "path",
                    "expected": "FAILED",
                    "argument": createAccountAssignment_creation_status,
                    "state": "failure"
                }
            ],
        },
    },
}
createAccountAssignment_waiter_model = WaiterModel(
    createAccountAssignment_waiter_config)
createAccountAssignment_waiter = create_waiter_with_client(
    createAccountAssignment_waiter_name, createAccountAssignment_waiter_model, sso_admin_client)
deleteAccountAssignment_waiter_name = 'AccountAssignmentDeleted'
deleteAccountAssignment_creation_status = 'AccountAssignmentDeletionStatus.Status'
deleteAccountAssignment_waiter_config = {
    'version': 2,
    'waiters': {
        'AccountAssignmentDeleted': {
            'operation': 'DescribeAccountAssignmentDeletionStatus',
            'delay': delay,
            'maxAttempts': max_attempts,
            'acceptors': [
                {
                    "matcher": "path",
                    "expected": "SUCCEEDED",
                    "argument": deleteAccountAssignment_creation_status,
                    "state": "success"
                },
                {
                    "matcher": "path",
                    "expected": "IN_PROGRESS",
                    "argument": deleteAccountAssignment_creation_status,
                    "state": "retry"
                },
                {
                    "matcher": "path",
                    "expected": "FAILED",
                    "argument": deleteAccountAssignment_creation_status,
                    "state": "failure"
                }
            ],
        },
    },
}
deleteAccountAssignment_waiter_model = WaiterModel(
    deleteAccountAssignment_waiter_config)
deleteAccountAssignment_waiter = create_waiter_with_client(
    deleteAccountAssignment_waiter_name, deleteAccountAssignment_waiter_model, sso_admin_client)


def lambda_handler(event, context):
    message = json.loads(event['Records'][0]['Sns']['Message'])
    if (message['waiter_name'] == 'PermissionSetProvisioned'):
        try:
            permissionset_waiter.wait(
                InstanceArn=message['instance_arn'], ProvisionPermissionSetRequestId=message['request_id'])            
        except WaiterError as e:
            logger.error(
                "Exception in waiter_handler PermissionSetProvisioned block : {}\n{}".format(e,traceback.format_exc()))
            errorMessage['Subject'] = "PermissionSet could not be provisioned"
            errorMessage['error_Details'] = {
                'FailureReason': e.last_response['PermissionSetProvisioningStatus']['FailureReason'],
                'AccountId': e.last_response['PermissionSetProvisioningStatus']['TargetId'],
                'PermissionSetArn': e.last_response['AccountAssignmentCreationStatus']['PermissionSetArn'],
            }
            sns_client.publish(
                TopicArn=error_notifications_topic_arn,
                Message=json.dumps(errorMessage)
            )
    elif (message['waiter_name'] == 'AccountAssignmentCreated'):
        try:
            createAccountAssignment_waiter.wait(
                InstanceArn=message['instance_arn'], AccountAssignmentCreationRequestId=message['request_id'])            
            provisionedLinksTable.put_item(
                Item={
                    'parentLink': message['provisioned_links_key'],
                    'tagKeyLookUp': message['tag_key_lookup']
                }
            )
        except WaiterError as e:
            logger.error(
                "Exception in waiter_handler AccountAssignmentCreated block : {}\n{}".format(e,traceback.format_exc()))
            errorMessage['Subject'] = "Account Assignment could not be created"
            errorMessage['event_Details'] = event['Records'][0]['Sns']['Message']
            errorMessage['error_Details'] = {
                'FailureReason': e.last_response['AccountAssignmentCreationStatus']['FailureReason'],
                'AccountId': e.last_response['AccountAssignmentCreationStatus']['TargetId'],
                'GroupId': e.last_response['AccountAssignmentCreationStatus']['PrincipalId'],
                'PermissionSetArn': e.last_response['AccountAssignmentCreationStatus']['PermissionSetArn'],
            }
            sns_client.publish(
                TopicArn=error_notifications_topic_arn,
                Message=json.dumps(errorMessage)
            )
        except ClientError as e:
            logger.error("Account Assignment creation could not be updated in provisioned links table : {}\n{}".format(e,traceback.format_exc()))            
            errorMessage['Subject'] = "Account Assignment creation could not be updated in provisioned links table"
            errorMessage['event_Details'] = event['Records'][0]['Sns']['Message']
            errorMessage['error_Details'] = {
                'FailureReason': (e.response['Error']['Message'])
            }
            sns_client.publish(
                TopicArn=error_notifications_topic_arn,
                Message=json.dumps(errorMessage)
            )
    elif (message['waiter_name'] == 'AccountAssignmentDeleted'):
        try:
            deleteAccountAssignment_waiter.wait(
                InstanceArn=message['instance_arn'], AccountAssignmentDeletionRequestId=message['request_id'])            
            provisionedLinksTable.delete_item(
                Key={
                    'parentLink': message['provisioned_links_key']
                }
            )
        except WaiterError as e:
            logger.error(
                "Exception in waiter_handler AccountAssignmentDeleted block : {}\n{}".format(e,traceback.format_exc()))
            errorMessage['Subject'] = "Account Assignment could not be deleted"
            errorMessage['event_Details'] = event['Records'][0]['Sns']['Message']
            errorMessage['error_Details'] = {
                'FailureReason': e.last_response['AccountAssignmentDeletionStatus']['FailureReason'],
                'AccountId': e.last_response['AccountAssignmentDeletionStatus']['TargetId'],
                'GroupId': e.last_response['AccountAssignmentDeletionStatus']['PrincipalId'],
                'PermissionSetArn': e.last_response['AccountAssignmentDeletionStatus']['PermissionSetArn'],
            }
            sns_client.publish(
                TopicArn=error_notifications_topic_arn,
                Message=json.dumps(errorMessage)
            )
        except ClientError as e:
            logger.error("Account Assignment deletion could not be updated in provisioned links table : {}\n{}".format(e,traceback.format_exc()))                         
            errorMessage['Subject'] = "Account Assignment deletion could not be updated in provisioned links table"
            errorMessage['event_Details'] = event['Records'][0]['Sns']['Message']
            errorMessage['error_Details'] = {
                'FailureReason': (e.response['Error']['Message'])
            }
            sns_client.publish(
                TopicArn=error_notifications_topic_arn,
                Message=json.dumps(errorMessage)
            )

export interface LinkPayload {
  readonly linkData: string;
  readonly action: string;
}

export interface LinkS3Payload {
  readonly linkData: string;
}
export interface Tag {
  readonly Key: string;
  readonly Value: string;
}

export interface CustomerManagedPolicyObject {
  readonly Name: string;
  readonly Path?: string;
}
export interface CreateUpdatePermissionSetDataProps {
  readonly permissionSetName: string;
  readonly description?: string;
  readonly sessionDurationInMinutes: string;
  readonly relayState: string;
  readonly tags: Array<Tag>;
  readonly managedPoliciesArnList: Array<string>;
  readonly customerManagedPoliciesList: Array<CustomerManagedPolicyObject>;
  readonly inlinePolicyDocument: Record<string, unknown>;
}
export interface CreateUpdatePermissionSetPayload {
  readonly action: string;
  readonly permissionSetData: CreateUpdatePermissionSetDataProps;
}

export interface DeletePermissionSetDataProps {
  readonly permissionSetName: string;
}

export interface DeletePermissionSetPayload {
  readonly action: string;
  readonly permissionSetData: DeletePermissionSetDataProps;
}

export interface ErrorMessage {
  readonly eventDetail?: string;
  readonly errorDetails?: string;
  readonly Subject?: string;
}

export interface ErrorNotificationPayload {
  readonly TopicArn?: string;
  readonly Message: string;
}

export interface LinkData {
  readonly awsEntityId: string;
  readonly awsEntityType: string;
  readonly awsEntityData: string;
  readonly permissionSetName: string;
  readonly principalName: string;
  readonly principalType: string;
}

export interface StateMachinePayload {
  readonly entityType: string;
  readonly action: string;
  readonly topicArn: string;
  readonly instanceArn: string;
  readonly targetType: string;
  readonly principalType: string;
  readonly permissionSetArn: string;
  readonly principalId: string;
  readonly sourceRequestId: string;
  readonly pageSize: number;
  readonly waitSeconds: number;
  readonly supportNestedOU: string;
}

export interface StaticSSOPayload {
  readonly InstanceArn: string;
  readonly TargetType: string;
  readonly PrincipalType: string;
}

export enum requestStatus {
  InProgress = "InProgress",
  Completed = "Completed",
  FailedWithError = "FailedWithError",
  FailedWithException = "FailedWithException",
  OnHold = "OnHold",
  Aborted = "Aborted",
}

export enum logModes {
  Exception = "Exception",
  Info = "Info",
  Debug = "Debug",
  Warn = "Warn",
}

export interface LogMessage {
  readonly logMode: logModes;
  readonly handler: string;
  readonly requestId?: string;
  readonly status: requestStatus;
  readonly statusMessage?: string;
  readonly relatedData?: string;
  readonly hasRelatedRequests?: boolean;
  readonly sourceRequestId?: string;
}

export interface CustomerManagedPolicyObjectOp {
  readonly operation: "attach" | "detach" | "describe";
  readonly parentOperation?: "attach" | "detach";
  readonly customerManagedPolicy: CustomerManagedPolicyObject;
  readonly permissionSetArn: string;
  readonly instanceArn: string;
}

export interface ManagedPolicyObjectOp {
  readonly operation: "attach" | "detach" | "describe";
  readonly parentOperation?: "attach" | "detach";
  readonly managedPolicyArn: string;
  readonly permissionSetArn: string;
  readonly instanceArn: string;
}

export interface DescribeOpIterator {
  readonly iterator: {
    readonly count: number;
    readonly index: number;
    readonly step: number;
  };
}

export interface CustomerManagedPolicySFN {
  readonly instanceArn: string;
  readonly permissionSetArn: string;
  readonly waitSeconds: string;
  readonly operation: "attach" | "detach";
  readonly processOpArn: string;
  readonly iteratorArn: string;
  readonly customerManagedPoliciesList: Array<CustomerManagedPolicyObject>;
}

export interface ManagedPolicySFN {
  readonly instanceArn: string;
  readonly permissionSetArn: string;
  readonly waitSeconds: string;
  readonly operation: "attach" | "detach";
  readonly processOpArn: string;
  readonly iteratorArn: string;
  readonly managedPoliciesArnList: Array<string>;
}

export interface ManagedPolicyQueueObject {
  readonly managedPolicytype: "aws" | "customer";
  readonly stateMachineArn: string;
  readonly managedPolicyObject: CustomerManagedPolicySFN | ManagedPolicySFN;
}

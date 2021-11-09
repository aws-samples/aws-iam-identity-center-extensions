export interface LinkPayload {
  readonly linkData: string;
  readonly action: string;
}
export interface Tag {
  readonly Key: string;
  readonly Value: string;
}
export interface CreateUpdatePermissionSetDataProps {
  readonly permissionSetName: string;
  readonly sessionDurationInMinutes: string;
  readonly relayState: string;
  readonly tags: Array<Tag>;
  readonly managedPoliciesArnList: Array<string>;
  readonly inlinePolicyDocument: Object;
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
  readonly groupName: string;
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
}

export interface StaticSSOPayload {
  readonly InstanceArn: string;
  readonly TargetType: string;
  readonly PrincipalType: string;
}

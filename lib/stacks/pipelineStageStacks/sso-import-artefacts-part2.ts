import { CustomResource, Duration, Stack, StackProps } from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { Topic } from "aws-cdk-lib/aws-sns";
import { EmailSubscription } from "aws-cdk-lib/aws-sns-subscriptions";
import { Queue, QueueEncryption } from "aws-cdk-lib/aws-sqs";
import { StringParameter } from "aws-cdk-lib/aws-ssm";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct } from "constructs";
import { join } from "path";
import { BuildConfig } from "../../build/buildConfig";
import { SSMParamReader } from "../../constructs/ssm-param-reader";
import { SSOObjectsDiscoveryPart2 } from "../../constructs/sso-objects-discovery-part2";

function name(buildConfig: BuildConfig, resourcename: string): string {
  return buildConfig.Environment + "-" + resourcename;
}

export class SSOImportArtefactsPart2 extends Stack {
  constructor(
    scope: Construct,
    id: string,
    props: StackProps | undefined,
    buildConfig: BuildConfig
  ) {
    super(scope, id, props);

    /**
     * We deploy SSO objects discovery part 2 for both nightly run and import
     * current config use cases
     */

    const deploySSOObjectsDiscoveryPart2 = new SSOObjectsDiscoveryPart2(
      this,
      name(buildConfig, "deploySSOObjectsDiscoveryPart2"),
      buildConfig
    );
    /** Use case specific additions */

    /**
     * If import current config is enabled, we want to trigger the state machine
     * as part of the pipeline deployment using CloudFormation Custom Resource
     * CDK framework
     */

    if (buildConfig.Parameters.ImportCurrentSSOConfiguration === true) {
      const updateCustomResourceHandler = new NodejsFunction(
        this,
        name(buildConfig, `updateCustomResourceHandler`),
        {
          runtime: lambda.Runtime.NODEJS_16_X,
          functionName: name(buildConfig, `updateCustomResourceHandler`),
          layers: [deploySSOObjectsDiscoveryPart2.nodeJsLayer],
          entry: join(
            __dirname,
            "../../../",
            "lib",
            "lambda-functions",
            "current-config-handlers",
            "src",
            "update-custom-resource.ts"
          ),
          bundling: {
            externalModules: [
              "@aws-sdk/client-sfn",
              "@aws-sdk/credential-providers",
            ],
            minify: true,
          },
          environment: {
            smDescribeRoleArn:
              deploySSOObjectsDiscoveryPart2.currentConfigSMDescribeRoleArn,
            ssoAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
            ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          },
        }
      );

      if (updateCustomResourceHandler.role) {
        updateCustomResourceHandler.addToRolePolicy(
          new PolicyStatement({
            resources: [
              deploySSOObjectsDiscoveryPart2.currentConfigSMDescribeRoleArn,
            ],
            actions: ["sts:AssumeRole"],
          })
        );
      }

      const parentSMInvokePolicy = new PolicyStatement({
        resources: [
          deploySSOObjectsDiscoveryPart2.currentConfigSMInvokeRoleArn,
        ],
        actions: ["sts:AssumeRole"],
      });

      const parentSMInvokeFunction = new NodejsFunction(
        this,
        name(buildConfig, `parentSMInvokeFunction`),
        {
          runtime: lambda.Runtime.NODEJS_16_X,
          functionName: name(buildConfig, `parentSMInvokeFunction`),
          layers: [deploySSOObjectsDiscoveryPart2.nodeJsLayer],
          entry: join(
            __dirname,
            "../../../",
            "lib",
            "lambda-functions",
            "current-config-handlers",
            "src",
            "trigger-parentSM.ts"
          ),
          bundling: {
            externalModules: [
              "@aws-sdk/client-sfn",
              "@aws-sdk/credential-providers",
              "uuid",
            ],
            minify: true,
          },
        }
      );

      if (parentSMInvokeFunction.role) {
        parentSMInvokeFunction.role.addToPrincipalPolicy(parentSMInvokePolicy);
      }

      const parentSMInvokeProvider = new Provider(
        this,
        name(buildConfig, "parentSMInvokeProvider"),
        {
          onEventHandler: parentSMInvokeFunction,
          isCompleteHandler: updateCustomResourceHandler,
          queryInterval: Duration.seconds(5),
          totalTimeout: Duration.minutes(120), // to handle scenarios where organisations have a lot of existing account assignments already
        }
      );

      const parentSMResource = new CustomResource(
        this,
        name(buildConfig, "parentSMResource"),
        {
          serviceToken: parentSMInvokeProvider.serviceToken,
          properties: {
            smInvokeRoleArn:
              deploySSOObjectsDiscoveryPart2.currentConfigSMInvokeRoleArn,
            importCurrentConfigSMArn: `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-importCurrentConfigSM`,
            importAccountAssignmentSMArn: `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-importAccountAssignmentSM`,
            importPermissionSetSMArn: `arn:aws:states:${buildConfig.PipelineSettings.SSOServiceAccountRegion}:${buildConfig.PipelineSettings.SSOServiceAccountId}:stateMachine:${buildConfig.Environment}-importPermissionSetSM`,
            accountAssignmentImportTopicArn:
              deploySSOObjectsDiscoveryPart2.accountAssignmentImportTopic
                .topicArn,
            permissionSetImportTopicArn:
              deploySSOObjectsDiscoveryPart2.permissionSetImportTopic.topicArn,
            temporaryPermissionSetTableName: `${buildConfig.Environment}-temp-PermissionSets`,
            ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          },
        }
      );

      parentSMResource.node.addDependency(
        deploySSOObjectsDiscoveryPart2.importAccountAssignmentHandler
      );
      parentSMResource.node.addDependency(
        deploySSOObjectsDiscoveryPart2.importPermissionSetHandler
      );
      parentSMResource.node.addDependency(updateCustomResourceHandler);
    }

    /**
     * If nightly run is enabled, we create 2 SQS FIFO queues for managing
     * deviations as well as the subscriber lambda functions for these queues to
     * process message payloads. We also import references to other resources
     * created in prior stacks for processing the remediation
     */
    if (buildConfig.Parameters.EnableNightlyRun === true) {
      /** Import the existing SQS key created in the preSolutionArtefacts stage */
      const sqsKey = Key.fromKeyArn(
        this,
        name(buildConfig, "importedSQSKeyArn"),
        StringParameter.valueForStringParameter(
          this,
          name(buildConfig, `queuesKeyArn`)
        )
      );

      /** Import the nightlyRun role arn to use in the processing lambda */
      const nightlyRunRoleArn = new SSMParamReader(
        this,
        name(buildConfig, "nightlyRunRoleArnpr"),
        buildConfig,
        {
          ParamAccountId: buildConfig.PipelineSettings.SSOServiceAccountId,
          ParamRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
          ParamNameKey: "nightlyRun-ssoapi-roleArn",
        }
      ).paramValue;
      /** Create common DLQ for both nightly run queues */
      const nightlyRunDLQ = new Queue(
        this,
        name(buildConfig, `nightlyRunDLQ`),
        {
          fifo: true,
          encryption: QueueEncryption.KMS,
          encryptionMasterKey: sqsKey,
          visibilityTimeout: Duration.hours(10),
          queueName: name(buildConfig, "nightlyRunDLQ.fifo"),
        }
      );
      /**
       * Create one queue - as strict ordering would be required such that
       * account assignments are remediated first and only then permission sets,
       * as otherwise the API call would fail due to related links being present
       */
      const nightlyRunDeviationQ = new Queue(
        this,
        name(buildConfig, "nightlyRunDeviationQ"),
        {
          fifo: true,
          encryption: QueueEncryption.KMS,
          encryptionMasterKey: sqsKey,
          visibilityTimeout: Duration.hours(2),
          contentBasedDeduplication: true,
          queueName: name(buildConfig, "nightlyRunDeviationQ.fifo"),
          deadLetterQueue: {
            queue: nightlyRunDLQ,
            maxReceiveCount: 4,
          },
        }
      );

      /** Grant the permissionsetHandler to post paylaods to the deviation queue */
      nightlyRunDeviationQ.grantSendMessages(
        deploySSOObjectsDiscoveryPart2.importPermissionSetHandler
      );

      /** Grant the account assignmet handler to post paylaods to the deviation queue */
      nightlyRunDeviationQ.grantSendMessages(
        deploySSOObjectsDiscoveryPart2.importAccountAssignmentHandler
      );

      /**
       * Export the queue link URL's as SSM parameters for import lambda's to
       * read from. Also, grant the relevant handlers permission to read the
       * parameter values from.
       */
      const nightlyRunDeviationQParam = new StringParameter(
        this,
        name(buildConfig, "nightlyRunDeviationQURL"),
        {
          parameterName: name(buildConfig, "nightlyRunDeviationQURL"),
          stringValue: nightlyRunDeviationQ.queueUrl,
        }
      );
      nightlyRunDeviationQParam.grantRead(
        deploySSOObjectsDiscoveryPart2.importPermissionSetHandler
      );
      nightlyRunDeviationQParam.grantRead(
        deploySSOObjectsDiscoveryPart2.importAccountAssignmentHandler
      );

      /** Create nightlyRunProcessing lambda */
      const nightlyRunProcessor = new NodejsFunction(
        this,
        name(buildConfig, `nightlyRunProcessor`),
        {
          runtime: lambda.Runtime.NODEJS_16_X,
          functionName: name(buildConfig, `nightlyRunProcessor`),
          layers: [deploySSOObjectsDiscoveryPart2.nodeJsLayer],
          entry: join(
            __dirname,
            "../../../",
            "lib",
            "lambda-functions",
            "current-config-handlers",
            "src",
            "nightlyRun.ts"
          ),
          bundling: {
            externalModules: [
              "@aws-sdk/client-sns",
              "@aws-sdk/client-ssm",
              "@aws-sdk/client-sso-admin",
              "@aws-sdk/credential-providers",
            ],
            minify: true,
          },
          environment: {
            remediationMode: buildConfig.Parameters.NightlyRunRemediationMode,
            ssoRegion: buildConfig.PipelineSettings.SSOServiceAccountRegion,
            SSOAPIRoleArn: nightlyRunRoleArn,
            env: buildConfig.Environment,
          },
        }
      );

      nightlyRunProcessor.addEventSource(
        new SqsEventSource(nightlyRunDeviationQ, {
          batchSize: 5,
        })
      );

      if (nightlyRunProcessor.role) {
        nightlyRunProcessor.addToRolePolicy(
          new PolicyStatement({
            resources: [nightlyRunRoleArn],
            actions: ["sts:AssumeRole"],
          })
        );
      }

      if (
        buildConfig.Parameters.NightlyRunRemediationMode.toUpperCase() ===
        "NOTIFY"
      ) {
        /** Import the existing SNS key created in the preSolutionArtefacts stage */
        const snsKey = Key.fromKeyArn(
          this,
          name(buildConfig, "importedSNSKeyArn"),
          StringParameter.valueForStringParameter(
            this,
            name(buildConfig, "snsTopicsKeyArn")
          )
        );
        /** Create SNS topic for notifying nightly Run deviations */
        const nightlyRunNotificationTopic = new Topic(
          this,
          name(buildConfig, "nightlyRunNotificationTopic"),
          {
            displayName: name(buildConfig, "nightlyRunNotificationTopic"),
            masterKey: snsKey,
            topicName: name(buildConfig, "nightlyRunNotificationTopic"),
          }
        );
        /** Export the topic arn for the nightlyRun processor to read */
        const nightlyRunTopicArn = new StringParameter(
          this,
          name(buildConfig, "nightlyRunTopicArn"),
          {
            parameterName: name(buildConfig, "nightlyRunTopicArn"),
            stringValue: nightlyRunNotificationTopic.topicArn,
          }
        );
        /** Add notification email as a subscriber to the remediation topic */
        nightlyRunNotificationTopic.addSubscription(
          new EmailSubscription(buildConfig.Parameters.NotificationEmail)
        );
        /**
         * Grant nightlyRun processor permissions to post to the topic, topic
         * arn param read along with the KMS permissions
         */
        nightlyRunNotificationTopic.grantPublish(nightlyRunProcessor);
        snsKey.grantEncryptDecrypt(nightlyRunProcessor);
        nightlyRunTopicArn.grantRead(nightlyRunProcessor);
      }
    }
  }
}

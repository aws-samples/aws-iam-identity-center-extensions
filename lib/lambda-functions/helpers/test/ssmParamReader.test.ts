//Import Libraries
import { mockClient } from "aws-sdk-client-mock";
import { GetParameterCommand, SSM, SSMClient } from "@aws-sdk/client-ssm";
import { SNSClient } from "@aws-sdk/client-sns";
import { handler } from "../src/ssmParamReader";
import {
  CloudFormationCustomResourceEvent,
  CloudFormationCustomResourceCreateEvent,
  CloudFormationCustomResourceResponse,
} from "aws-lambda";
import { RepositoryNotificationEvents } from "aws-cdk-lib/aws-codecommit";

// Import test data to mock
const mockCreate: CloudFormationCustomResourceCreateEvent = require("../data/ssmParamReader_Create.json");
const mockDelete: CloudFormationCustomResourceCreateEvent = require("../data/ssmParamReader_Delete.json");
const mockMalformed: CloudFormationCustomResourceCreateEvent = require("../data/ssmParamReader_Malformed.json");
const ssmMock = mockClient(SSMClient);

describe("SSM Test", () => {
  // Set SSM Parameter
  ssmMock
    .on(GetParameterCommand, {
      Name: "tony/test",
    })
    .resolves({
      Parameter: {
        Name: "tony/test",
        Type: "String",
        Value: "testvalue",
        Version: 1,
        ARN: "arn:aws:ssm:us-west-1:123:/tony/test",
      },
    });
  it("Testing Create Success", async () => {
    const response: CloudFormationCustomResourceResponse = await handler(
      mockCreate
    );
    console.log(JSON.stringify(response));
    expect(response.Status).toBe("SUCCESS");
    expect(response.Data).toBeDefined();
  });

  it("Testing Create Failure", async () => {
    const response: CloudFormationCustomResourceResponse = await handler(
      mockMalformed
    );
    expect(response.Status).toBe("FAILED");
  });

  it("Testing Delete", async () => {
    const response: CloudFormationCustomResourceResponse = await handler(
      mockDelete
    );
    expect(response.Status).toBe("SUCCESS");
  });
});

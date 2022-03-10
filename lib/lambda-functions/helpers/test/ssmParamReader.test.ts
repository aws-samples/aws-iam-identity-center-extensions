//Import Libraries
import { mockClient } from "aws-sdk-client-mock";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";
import { handler } from "../src/ssmParamReader";
import {
  CloudFormationCustomResourceCreateEvent,
  CloudFormationCustomResourceDeleteEvent,
  CloudFormationCustomResourceResponse,
} from "aws-lambda";

import * as mockCreateJSON from "../data/ssmParamReader_Create.json"
import * as mockDeleteJSON from "../data/ssmParamReader_Delete.json"
import * as mockMalformedJSON from "../data/ssmParamReader_Malformed.json"
/**
 * aws-lambda uses enum while aws-sdk/types uses string for request type
 * 
 */
const mockCreate: CloudFormationCustomResourceCreateEvent = {...mockCreateJSON,RequestType:"Create"}
const mockDelete: CloudFormationCustomResourceDeleteEvent = {...mockDeleteJSON,RequestType:"Delete",PhysicalResourceId:"12345"}
const mockMalformed: CloudFormationCustomResourceCreateEvent = {...mockMalformedJSON,RequestType:"Create"}
const ssmMock = mockClient(SSMClient);

// import * as importAccountAssignmentsSMJSON from "../../state-machines/import-account-assignments.json";


describe("SSM Test", () => {
  // Set SSM Parameter
  ssmMock
    .on(GetParameterCommand, {
      Name: "unicorn/test",
    })
    .resolves({
      Parameter: {
        Name: "unicorn/test",
        Type: "String",
        Value: "testvalue",
        Version: 1,
        ARN: "arn:aws:ssm:us-west-1:123:/unicorn/test",
      },
    });
  it("Testing Create Success", async () => {
    const response: CloudFormationCustomResourceResponse = await handler(
      mockCreate
    );
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

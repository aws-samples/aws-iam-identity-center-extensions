import {
  IdentitystoreClient,
  ListGroupsCommand,
  ListGroupsCommandOutput,
  ListUsersCommand,
  ListUsersCommandOutput,
} from "@aws-sdk/client-identitystore";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { Readable } from "stream";
import { LogMessage, StateMachinePayload } from "./interfaces";
/* eslint-disable  @typescript-eslint/no-explicit-any */
export const removeEmpty = (obj: { [x: string]: any }) => {
  Object.keys(obj).forEach(
    (k) =>
      (obj[`${k}`] &&
        typeof obj[`${k}`] === "object" &&
        removeEmpty(obj[`${k}`])) ||
      (!obj[`${k}`] && obj[`${k}`] !== undefined && delete obj[`${k}`])
  );
  return obj;
};

export async function streamToString(stream: Readable): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

export const invokeStepFunction = async (
  payload: StateMachinePayload,
  entityValue: string,
  stateMachineArn: string,
  sfnClient: SFNClient
) => {
  let computedOUId = "";
  let computedTagKey = "";
  let computedTagValues = "";
  if (payload.entityType === "ou_id") {
    computedOUId = entityValue;
  } else if (payload.entityType === "account_tag") {
    computedTagKey = entityValue?.split("^")[0] + "";
    computedTagValues = entityValue?.split("^")[1] + "";
  }

  await sfnClient.send(
    new StartExecutionCommand({
      stateMachineArn: stateMachineArn,
      input: JSON.stringify({
        ...payload,
        tagKey: computedTagKey,
        emptyString: "",
        tagValues: computedTagValues,
        ou_id: computedOUId,
        resourceTypeFilters: "organizations:account",
      }),
    })
  );
};

export function logger(logMessage: LogMessage) {
  switch (logMessage.logMode) {
    case "info": {
      console.log(JSON.stringify(logMessage));
      break;
    }
    case "warn": {
      console.warn(JSON.stringify(logMessage));
      break;
    }
    case "error": {
      console.error(JSON.stringify(logMessage));
      break;
    }
    default: {
      console.error(JSON.stringify(logMessage));
      break;
    }
  }
}

export class StateMachineError extends Error {
  constructor(public errorMessage: { message: string }) {
    super();
  }
}

export const resolvePrincipal = async (
  identityStoreId: string,
  identityStoreClientObject: IdentitystoreClient,
  principalType: string,
  principalName: string
): Promise<string> => {
  if (principalType === "GROUP") {
    const listGroupsResult: ListGroupsCommandOutput =
      await identityStoreClientObject.send(
        new ListGroupsCommand({
          IdentityStoreId: identityStoreId,
          Filters: [
            {
              AttributePath: "DisplayName",
              AttributeValue: principalName,
            },
          ],
        })
      );
    if (listGroupsResult.Groups?.length !== 0) {
      return listGroupsResult.Groups?.[0].GroupId + "";
    } else {
      return "0";
    }
  } else if (principalType === "USER") {
    const listUsersResult: ListUsersCommandOutput =
      await identityStoreClientObject.send(
        new ListUsersCommand({
          IdentityStoreId: identityStoreId,
          Filters: [
            {
              AttributePath: "UserName",
              AttributeValue: principalName,
            },
          ],
        })
      );
    if (listUsersResult.Users?.length !== 0) {
      return listUsersResult.Users?.[0].UserId + "";
    } else {
      return "0";
    }
  }
  return "0";
};

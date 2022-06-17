import {
  IdentitystoreClient,
  ListGroupsCommand,
  ListGroupsCommandOutput,
  ListUsersCommand,
  ListUsersCommandOutput,
} from "@aws-sdk/client-identitystore";
import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { Readable } from "stream";
import { LogMessage, logModes, StateMachinePayload } from "./interfaces";
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

/**
 * Custom logger utility that serves as factory pattern for writing your own custom logs.
 *
 * - This utility considers log level of the log message as well as the log level
 *   of the function.
 * - If the function log level is debug, then all debug, info, warn and exception
 *   logs are processed.
 * - If the function log level is info, then all info, warn and exception logs are
 *   processed.
 * - If the function log level is warn, then all warn and exception logs are processed.
 * - If the function log level is exception then all exception logs are processed.
 * - If no function log level is passed, then all logs are processed
 *
 * @param logMessage Raw log message
 * @param functionLogMode Function logging configuraiton as read from buildConfig
 */
export function logger(logMessage: LogMessage, functionLogMode?: string) {
  switch (functionLogMode) {
    case logModes.Debug.valueOf(): {
      /** Since the function is set at debug log level, all logs are processed */
      console.log(JSON.stringify(logMessage));
      break;
    }
    case logModes.Info.valueOf(): {
      /**
       * Since the function is set at info level, only info, warn and exception
       * logs are processed
       */
      if (
        logMessage.logMode.valueOf() === logModes.Info.valueOf() ||
        logMessage.logMode.valueOf() === logModes.Warn.valueOf() ||
        logMessage.logMode.valueOf() === logModes.Exception.valueOf()
      )
        console.log(JSON.stringify(logMessage));
      break;
    }
    case logModes.Warn.valueOf(): {
      /**
       * Since the function is set at warn level, only warn and exception logs
       * are processed
       */
      if (
        logMessage.logMode.valueOf() === logModes.Warn.valueOf() ||
        logMessage.logMode.valueOf() === logModes.Exception.valueOf()
      )
        console.log(JSON.stringify(logMessage));
      break;
    }
    case logModes.Exception.valueOf(): {
      /** Since the function is set at exception level, only exception logs are processed */
      if (logMessage.logMode.valueOf() === logModes.Exception.valueOf())
        console.log(JSON.stringify(logMessage));
      break;
    }
    default: {
      console.log(JSON.stringify(logMessage));
      break;
    }
  }
}

export const constructExceptionMessage = (
  handler: string,
  name: string,
  message: string,
  relatedData: string
) => {
  return JSON.stringify(
    JSON.parse(
      JSON.stringify(
        {
          handler: handler,
          exceptionName: name,
          exceptionMessage: message,
          relatedData: relatedData,
        },
        null,
        2
      )
    ),
    null,
    2
  );
};

export const constructExceptionMessageforLogger = (
  handler: string,
  name: string,
  message: string,
  relatedData: string
) => {
  return `Exception ${name} occurred. Exception message is -> ${message} . Related data for the exception -> ${relatedData}`;
};

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

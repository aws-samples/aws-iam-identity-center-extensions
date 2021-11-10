import { SFNClient, StartExecutionCommand } from "@aws-sdk/client-sfn";
import { Readable } from "stream";
import { StateMachinePayload } from "./interfaces";
export const removeEmpty = (obj: { [x: string]: any }) => {
  Object.keys(obj).forEach(
    (k) =>
      (obj[k] && typeof obj[k] === "object" && removeEmpty(obj[k])) ||
      (!obj[k] && obj[k] !== undefined && delete obj[k])
  );
  return obj;
};

export async function streamToString(stream: Readable): Promise<string> {
  return await new Promise((resolve, reject) => {
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

export function MinutesToISO8601Duration(minutes: number) {
  let s = minutes;
  const days = Math.floor(s / 1440);
  s -= days * 1440;
  const hours = Math.floor(s / 60);
  s -= hours * 60;
  let dur = "PT";
  if (days > 0) {
    dur += `${days}D`;
  }
  if (hours > 0) {
    dur += `${hours}H`;
  }
  dur += `${s}M`;
  return dur;
}

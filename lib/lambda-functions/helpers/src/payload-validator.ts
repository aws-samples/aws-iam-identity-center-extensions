import { ValidateFunction } from "ajv";

export class JSONParserError extends Error {
  constructor(public errors: { errorCode: string; message?: string }[]) {
    super();
  }
}

export const imperativeParseJSON = <T = object>(
  data: object | string | null,
  validate: ValidateFunction
): T => {
  if (!data) {
    throw new JSONParserError([{ errorCode: "null_json" }]);
  }

  try {
    const parsed = typeof data === "string" ? JSON.parse(data) : data;
    if (validate(parsed)) {
      return parsed as T;
    }
  } catch (e) {
    throw new JSONParserError([{ errorCode: "malformed_json" }]);
  }

  throw new JSONParserError(
    validate.errors!.map(({ keyword, message }) => ({
      errorCode: keyword,
      message,
    }))
  );
};

export interface LinkPayload {
  readonly linkData: string;
  readonly action: string;
}

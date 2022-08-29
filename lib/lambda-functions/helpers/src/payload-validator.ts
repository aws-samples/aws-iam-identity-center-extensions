import { ValidateFunction } from "ajv";

export class JSONParserError extends Error {
  constructor(public errors: { errorCode: string; message?: string }[]) {
    super();
  }
}

export class ManagedPolicyError extends Error {
  constructor(public permissionSetName: string) {
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
    validate.errors!.map(({ instancePath, params }) => ({
      errorCode: `pattern-error`,
      message: `Failure on property ${instancePath} . Schema for property should match pattern ${params.pattern}`,
    }))
  );
};

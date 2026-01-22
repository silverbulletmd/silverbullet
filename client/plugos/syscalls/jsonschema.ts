import type { SysCallMapping } from "../system.ts";
import { Ajv, type ValidateFunction } from "ajv";

const ajv = new Ajv();

ajv.addFormat("email", {
  validate: (data: string) => {
    // TODO: Implement email validation
    return data.includes("@");
  },
  async: false,
});

ajv.addFormat("page-ref", {
  validate: (data: string) => {
    return data.startsWith("[[") && data.endsWith("]]");
  },
  async: false,
});

const schemaCache = new Map<string, ValidateFunction>();

export function validateObject(schema: any, object: any): undefined | string {
  try {
    const schemaKey = JSON.stringify(schema);
    if (!schemaCache.has(schemaKey)) {
      const validate = ajv.compile(schema);
      schemaCache.set(schemaKey, validate);
    }
    const validate = schemaCache.get(schemaKey)!;
    if (validate(object)) {
      return;
    } else {
      let text = ajv.errorsText(validate.errors);
      text = text.replaceAll("/", ".");
      text = text.replace(/^data[\.\s]/, "");
      return text;
    }
  } catch (e: any) {
    return e.message;
  }
}

export function validateSchema(schema: any): undefined | string {
  const valid = ajv.validateSchema(schema);
  if (valid) {
    return;
  } else {
    return ajv.errorsText(ajv.errors);
  }
}

export function jsonschemaSyscalls(): SysCallMapping {
  return {
    "jsonschema.validateObject": (
      _ctx,
      schema: any,
      object: any,
    ): undefined | string => {
      return validateObject(schema, object);
    },
    "jsonschema.validateSchema": (
      _ctx,
      schema: any,
    ): undefined | string => {
      return validateSchema(schema);
    },
  };
}

import type { SysCallMapping } from "../system.ts";
import { type OutputUnit, Validator, format } from "@cfworker/json-schema";
import { stripFunctions } from "../util.ts";

// Register custom formats
format.email = (data: string) => data.includes("@");
format["page-ref"] = (data: string) =>
  data.startsWith("[[") && data.endsWith("]]");

const schemaCache = new Map<string, Validator>();

function formatErrors(errors: OutputUnit[]): string {
  // Filter out "properties" wrapper errors, keep only the specific leaf errors
  const leafErrors = errors.filter((e) => e.keyword !== "properties");
  const errorsToUse = leafErrors.length > 0 ? leafErrors : errors;

  return errorsToUse
    .map((e) => {
      // Convert instanceLocation from "#/foo/bar" to "foo.bar"
      const path =
        e.instanceLocation === "#"
          ? ""
          : e.instanceLocation.slice(2).replaceAll("/", ".");
      return path ? `${path}: ${e.error}` : e.error;
    })
    .join(", ");
}

export function validateObject(schema: any, object: any): undefined | string {
  try {
    const schemaKey = JSON.stringify(schema);
    if (!schemaCache.has(schemaKey)) {
      const validator = new Validator(schema, "7");
      schemaCache.set(schemaKey, validator);
    }
    const validator = schemaCache.get(schemaKey)!;
    const result = validator.validate(stripFunctions(object));
    if (result.valid) {
      return;
    } else {
      return formatErrors(result.errors);
    }
  } catch (e: any) {
    return e.message;
  }
}

export function validateSchema(schema: any): undefined | string {
  if (schema === null || schema === undefined) {
    return "schema must not be null or undefined";
  }
  if (typeof schema === "boolean") {
    return;
  }
  if (typeof schema !== "object" || Array.isArray(schema)) {
    return "schema must be an object or boolean";
  }
  if (schema.type !== undefined) {
    const validTypes = [
      "string",
      "number",
      "integer",
      "boolean",
      "object",
      "array",
      "null",
    ];
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const t of types) {
      if (!validTypes.includes(t)) {
        return `schema.type must be one of ${validTypes.join(", ")}`;
      }
    }
  }
  return;
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
    "jsonschema.validateSchema": (_ctx, schema: any): undefined | string => {
      return validateSchema(schema);
    },
  };
}

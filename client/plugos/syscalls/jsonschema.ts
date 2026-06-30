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

/**
 * Best-effort: infer a JSON Schema (draft 2020-12) from the *shape* of a single
 * sample value. Types are guessed from one example, so the result is a hint,
 * not a contract — the top-level schema is marked `"x-inferred": true`.
 *
 * Useful when a tag/object type has no declared schema but an example object
 * exists and you want a plausible schema for it.
 */
export function inferFromObject(value: any): any {
  const schema = inferSchemaNode(value);
  schema["$schema"] = "https://json-schema.org/draft/2020-12/schema";
  schema["x-inferred"] = true;
  return schema;
}

/** Infer a bare JSON Schema node for a value, recursing into arrays/objects. */
function inferSchemaNode(value: any): any {
  if (value === null || value === undefined) {
    return { type: "null" };
  }
  if (Array.isArray(value)) {
    const node: any = { type: "array" };
    if (value.length > 0) {
      node.items = inferSchemaNode(value[0]);
    }
    return node;
  }
  switch (typeof value) {
    case "boolean":
      return { type: "boolean" };
    case "number":
      return { type: Number.isInteger(value) ? "integer" : "number" };
    case "string":
      return { type: "string" };
    case "object": {
      const properties: Record<string, any> = {};
      for (const [k, v] of Object.entries(value)) {
        properties[k] = inferSchemaNode(v);
      }
      return { type: "object", properties };
    }
    default:
      // functions, symbols, bigint, … — not representable in JSON Schema.
      return {};
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
    "jsonschema.validateSchema": (_ctx, schema: any): undefined | string => {
      return validateSchema(schema);
    },
    "jsonschema.inferFromObject": (_ctx, object: any): any => {
      return inferFromObject(object);
    },
  };
}

import type { ObjectValue } from "../../type/index.ts";

export type SimpleJSONType = {
  type?: "string" | "number" | "boolean" | "any" | "array" | "object" | "null";
  items?: SimpleJSONType;
  properties?: Record<string, SimpleJSONType>;
  anyOf?: SimpleJSONType[];
};

export type AdhocAttributeObject = ObjectValue<{
  name: string;
  schema: SimpleJSONType;
  tagName: string;
  page: string;
}>;

/**
 * Attempt some reasonable stringification of a JSON schema
 * @param schema
 * @returns
 */
export function jsonTypeToString(schema: SimpleJSONType): string {
  if (schema.anyOf) {
    return schema.anyOf.map(jsonTypeToString).join(" | ");
  } else if (schema.type === "array") {
    if (schema.items) {
      return `${jsonTypeToString(schema.items)}[]`;
    } else {
      return "any[]";
    }
  } else if (schema.type === "object") {
    if (schema.properties) {
      return `{${
        Object.entries(schema.properties).map(([k, v]) =>
          `${k}: ${jsonTypeToString(v)};`
        ).join(" ")
      }}`;
    } else {
      return "{}";
    }
  }
  return schema.type!;
}

export function determineType(v: any): SimpleJSONType {
  const t = typeof v;
  if (t === "undefined" || v === null) {
    return { type: "null" };
  } else if (t === "object") {
    if (Array.isArray(v)) {
      if (v.length === 0) {
        return {
          type: "array",
        };
      } else {
        return {
          type: "array",
          items: determineType(v[0]),
        };
      }
    } else {
      return {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(v).map(([k, v]) => [k, determineType(v)]),
        ),
      };
    }
  } else if (t === "number") {
    return { type: "number" };
  } else if (t === "boolean") {
    return { type: "boolean" };
  } else if (t === "string") {
    return { type: "string" };
  } else {
    return { type: "any" };
  }
}

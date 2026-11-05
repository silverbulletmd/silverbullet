/** The filters that take the Schema view's counts and values to the Objects view. */
import {
  type JsonSchema,
  schemaToLua,
} from "../../../config_management/schema_lua.ts";
import { isLuaName } from "../../query/query_attributes.ts";
import type { Filter } from "../../query/query_ops.ts";

export type SchemaLink =
  | { kind: "missing"; attribute: string }
  | { kind: "invalid"; attribute: string; schema: JsonSchema }
  | { kind: "value"; attribute: string; value: string };

/** Lua on one line, for a filter expression */
function oneLine(lua: string): string {
  return lua
    .replace(/,\s*\n\s*}/g, "}")
    .replace(/\s*\n\s*/g, " ")
    .replace(/{ /g, "{")
    .replace(/ }/g, "}");
}

/** The filter selecting the objects a link in the Schema view points at; `v` is the query's object variable */
export function objectsFilter(link: SchemaLink, v: string): Filter {
  switch (link.kind) {
    case "missing":
      return {
        kind: "attribute",
        attribute: link.attribute,
        op: "missing",
        values: [],
      };
    case "value":
      return {
        kind: "attribute",
        attribute: link.attribute,
        op: "is",
        values: [link.value],
      };
    case "invalid": {
      const name = link.attribute;
      const key = isLuaName(name) ? name : `[${JSON.stringify(name)}]`;
      const access = isLuaName(name) ? `${v}.${name}` : `${v}${key}`;
      const schema = oneLine(
        schemaToLua({ type: "object", properties: { [name]: link.schema } }),
      );
      return {
        kind: "expr",
        expr: `${access} ~= nil and jsonschema.validateObject(${schema}, {${key} = ${access}}) ~= nil`,
      };
    }
  }
}

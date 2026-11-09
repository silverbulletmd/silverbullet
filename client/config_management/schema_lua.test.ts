import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { loadConfig } from "../boot_config.ts";
import { extractSpaceLuaFromPageText } from "../space_lua_blocks_test_util.ts";
import { CONFIG_UNSET } from "../config.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import { scanStatements, toLua } from "./managed_lua.ts";
import {
  defineStatement,
  helperSchema,
  requireStatement,
  SCHEMA_LITERALS,
  schemaFromLua,
  schemaFromLuaText,
  schemaToLua,
  setStatement,
} from "./schema_lua.ts";

const scanSchemaStatements = (text: string) =>
  scanStatements(text, SCHEMA_LITERALS);

const read = (lua: string) => schemaFromLua(parseExpressionString(lua));
const roundTrip = (schema: unknown) => read(schemaToLua(schema as any));

const TAGS = {
  anyOf: [
    { type: "array", items: { type: "string", format: "tag" } },
    { type: "string", format: "tags" },
  ],
};

describe("schemaFromLua", () => {
  test("helper calls read as their JSON Schema", () => {
    expect(read("schema.string()")).toEqual({ type: "string" });
    expect(read("schema.number()")).toEqual({ type: "number" });
    expect(read("schema.boolean()")).toEqual({ type: "boolean" });
    expect(read("schema.null()")).toEqual({ type: "null" });
    expect(read("schema.object()")).toEqual({ type: "object" });
    expect(read("schema.date()")).toEqual({ type: "string", format: "date" });
    expect(read('schema.enum({"a", "b"})')).toEqual({
      type: "string",
      enum: ["a", "b"],
    });
    expect(read("schema.ref()")).toEqual({ type: "string", format: "ref" });
    expect(read('schema.ref("person")')).toEqual({
      type: "string",
      format: "ref",
      tag: "person",
    });
    expect(read("schema.tags()")).toEqual(TAGS);
    expect(read('schema.tags({description = "d"})')).toEqual({
      ...TAGS,
      description: "d",
    });
    expect(read("schema.identities()")).toEqual({
      anyOf: [
        { type: "array", items: { type: "string", format: "identity" } },
        { type: "string", format: "identities" },
      ],
    });
    expect(read('schema.nullable("number")')).toEqual({
      anyOf: [{ type: "number" }, { type: "null" }],
    });
    expect(read("schema.nullable(schema.date())")).toEqual({
      anyOf: [{ type: "string", format: "date" }, { type: "null" }],
    });
    expect(read('schema.nullableArray("string")')).toEqual({
      anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }],
    });
    expect(read('schema.array("string")')).toEqual({
      type: "array",
      items: { type: "string" },
    });
  });

  test("tables of helpers and literals read recursively", () => {
    expect(
      read(
        '{ type = "object", properties = { owner = schema.ref("person"), ["due-date"] = schema.date() }, required = {"owner"} }',
      ),
    ).toEqual({
      type: "object",
      properties: {
        owner: { type: "string", format: "ref", tag: "person" },
        "due-date": { type: "string", format: "date" },
      },
      required: ["owner"],
    });
  });

  test("anything else is unreadable", () => {
    expect(read("makeSchema()")).toBeUndefined();
    expect(read("schema.enum(values)")).toBeUndefined();
    expect(read("{ x = y }")).toBeUndefined();
  });
});

describe("schemaToLua", () => {
  test("writes helpers when the shape matches exactly", () => {
    expect(schemaToLua({ type: "string", format: "ref", tag: "person" })).toBe(
      'schema.ref("person")',
    );
    expect(schemaToLua({ type: "string" })).toBe("schema.string()");
    expect(schemaToLua({ type: "string", format: "date" })).toBe(
      "schema.date()",
    );
    expect(schemaToLua(TAGS)).toBe("schema.tags()");
    expect(schemaToLua({ anyOf: [{ type: "number" }, { type: "null" }] })).toBe(
      'schema.nullable("number")',
    );
  });

  test("a shape a helper doesn't produce is written as a literal table", () => {
    const lua = schemaToLua({
      type: "string",
      format: "ref",
      tag: "person",
      description: "d",
    });
    expect(lua).not.toContain("schema.ref");
    expect(read(lua)).toEqual({
      type: "string",
      format: "ref",
      tag: "person",
      description: "d",
    });
  });

  test("round trip keeps unknown keywords and nested anyOf", () => {
    for (const schema of [
      { type: "string", "x-note": 1, readOnly: true },
      { anyOf: [{ type: "number" }, { type: "string" }], description: "d" },
      { ...TAGS, description: "Topics", nullable: true },
      {
        type: "object",
        properties: {
          status: { type: "string", enum: ["a", "b"] },
          "due-date": { type: "string", format: "date" },
          Status: { type: "number" },
          日付: { type: "string" },
        },
        required: ["status"],
      },
    ]) {
      expect(roundTrip(schema)).toEqual(schema);
    }
  });
});

describe("statements", () => {
  test("scans define, set and require statements with their ranges", () => {
    const text = [
      "-- managed-by: workbench-schemas",
      'tag.define { name = "meeting", schema = { type = "object", properties = { room = schema.string() } } }',
      'config.set({"tags", "page", "schema", "properties", "category"}, schema.string())',
      'config.set({"tags", "page", "schema", "properties", "old"}, config.unset)',
      'tag.setRequired("page", "category", true)',
    ].join("\n");
    const statements = scanSchemaStatements(text);
    expect(
      statements.map(({ start: _s, end: _e, ...rest }) => {
        const { schemaRange: _r, ...plain } = rest as any;
        return plain;
      }),
    ).toEqual([
      {
        kind: "define",
        tag: "meeting",
        schema: {
          type: "object",
          properties: { room: { type: "string" } },
        },
        other: [],
      },
      {
        kind: "set",
        path: ["tags", "page", "schema", "properties", "category"],
        value: { type: "string" },
      },
      {
        kind: "set",
        path: ["tags", "page", "schema", "properties", "old"],
        value: CONFIG_UNSET,
      },
      { kind: "require", tag: "page", attribute: "category", required: true },
    ]);
    const define = statements[0];
    expect(text.slice(define.start, define.end)).toMatch(/^tag\.define/);
  });

  test("statements it can't read are opaque", () => {
    const kinds = scanSchemaStatements(
      [
        "local function f() end",
        "tag.define { name = someName, schema = {} }",
        "print(1)",
      ].join("\n"),
    ).map((s) => s.kind);
    expect(kinds).toEqual(["opaque", "opaque", "opaque"]);
  });

  test("a define whose schema can't be read has a null schema but its range", () => {
    const [st] = scanSchemaStatements(
      'tag.define { name = "x", schema = build() }',
    );
    expect(st).toMatchObject({ kind: "define", tag: "x", schema: null });
    expect(st).toHaveProperty("schemaRange");
  });

  test("other tag.define fields are listed", () => {
    const [st] = scanSchemaStatements(
      'tag.define { name = "x", tagPage = "X", schema = { type = "object" } }',
    );
    expect(st).toMatchObject({ kind: "define", other: ["tagPage"] });
  });

  test("written statements read back", () => {
    const schema = {
      type: "object",
      properties: { owner: { type: "string", format: "ref", tag: "person" } },
    };
    const path = ["tags", "page", "schema", "properties", "due-date"];
    const text = [
      defineStatement("project", schema),
      setStatement(path, { type: "string", format: "date" }),
      setStatement(
        ["tags", "page", "schema", "properties", "a.b"],
        CONFIG_UNSET,
      ),
      requireStatement("page", "due-date", false),
    ].join("\n");
    expect(
      scanSchemaStatements(text).map(({ start: _s, end: _e, ...rest }) => {
        const { schemaRange: _r, ...plain } = rest as any;
        return plain;
      }),
    ).toEqual([
      { kind: "define", tag: "project", schema, other: [] },
      { kind: "set", path, value: { type: "string", format: "date" } },
      {
        kind: "set",
        path: ["tags", "page", "schema", "properties", "a.b"],
        value: CONFIG_UNSET,
      },
      { kind: "require", tag: "page", attribute: "due-date", required: false },
    ]);
  });

  test("invalid Lua throws", () => {
    expect(() => scanSchemaStatements("tag.define {")).toThrow();
  });
});

describe("schemaFromLuaText", () => {
  test("reads a typed-in schema", () => {
    expect(
      schemaFromLuaText(
        '{ anyOf = { schema.number(), { type = "string", minLength = 2 } } }',
      ),
    ).toEqual({
      schema: {
        anyOf: [{ type: "number" }, { type: "string", minLength: 2 }],
      },
    });
  });

  test("explains what it can't read", () => {
    expect(schemaFromLuaText("{ type = ")).toMatchObject({
      error: expect.stringMatching(/Lua/),
    });
    expect(schemaFromLuaText("makeSchema()")).toEqual({
      error:
        "Only a table and schema.* helpers can be read here, not other Lua",
    });
  });
});

describe("schema helpers", () => {
  const CALLS: [string, unknown[]][] = [
    ["string", []],
    ["number", []],
    ["boolean", []],
    ["null", []],
    ["object", []],
    ["schema", []],
    ["func", []],
    ["date", []],
    ["ref", []],
    ["ref", ["person"]],
    ["enum", [["a", "b"]]],
    ["tags", []],
    ["tags", [{ description: "d", nullable: true }]],
    ["identities", []],
    ["identities", [{ description: "d" }]],
    ["array", ["string"]],
    ["array", [{ type: "object", properties: { n: { type: "string" } } }]],
    ["nullable", ["number"]],
    ["nullable", [{ type: "string", format: "date" }]],
    ["nullableArray", ["string"]],
    ["nullableArray", [{ type: "number", minimum: 1 }]],
  ];

  test("build what the Lua helpers of Library/Std/APIs/Schema return", async () => {
    const lua = extractSpaceLuaFromPageText(
      readFileSync("libraries/Library/Std/APIs/Schema.md", "utf8"),
    );
    const calls = CALLS.map(
      ([name, args], i) =>
        `config.set({"pin", "c${i}"}, schema.${name}(${args.map((a) => toLua(a)).join(", ")}))`,
    );
    const config = await loadConfig(
      [{ ref: "test", code: `${lua}\n${calls.join("\n")}` }],
      {},
      false,
    );
    CALLS.forEach(([name, args], i) => {
      expect(config.get(["pin", `c${i}`], undefined), calls[i]).toEqual(
        helperSchema(name, ...args),
      );
    });
  });

  test("every helper's schema is written as a helper call and reads back", () => {
    for (const [name, args] of CALLS) {
      if (name === "func") continue;
      const schema = helperSchema(name, ...args);
      expect(schemaToLua(schema)).toMatch(/^schema\./);
      expect(read(schemaToLua(schema))).toEqual(schema);
    }
  });

  test("null fields are dropped and non-finite numbers written as nil", () => {
    const lua = schemaToLua({
      type: "number",
      default: null,
      maximum: Number.NaN,
    });
    expect(lua).not.toContain("default");
    expect(lua).not.toContain("NaN");
    expect(lua).toContain("maximum = nil");
  });
});

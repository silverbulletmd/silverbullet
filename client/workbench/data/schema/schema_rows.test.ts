import { describe, expect, test } from "vitest";
import type { AttributeInfo } from "../../query/query_attributes.ts";
import {
  buildRows,
  inferredSchema,
  type RowsInput,
  schemaFor,
  withDraft,
} from "./schema_rows.ts";

function info(
  name: string,
  type: AttributeInfo["type"],
  extra: Partial<AttributeInfo> = {},
): AttributeInfo {
  return {
    name,
    type,
    source: "inferred",
    system: false,
    present: 1,
    total: 1,
    values: [],
    ...extra,
  };
}

function input(extra: Partial<RowsInput> = {}): RowsInput {
  return {
    effective: null,
    rootSchema: null,
    localPaths: new Set(),
    inferred: [],
    samples: [],
    ...extra,
  };
}

const byName = <T extends { name: string }>(rows: T[], name: string) =>
  rows.find((r) => r.name === name);

describe("buildRows", () => {
  test("declared attributes absent from the samples still appear", () => {
    const rows = buildRows(
      input({
        effective: {
          type: "object",
          properties: { status: { type: "string" } },
        },
      }),
    );
    expect(byName(rows, "status")).toMatchObject({
      origin: "declared",
      present: 0,
      sampled: 0,
    });
  });

  test("root attributes are inherited, and a local extension of page is local", () => {
    const page = {
      type: "object",
      properties: { name: { type: "string" }, category: { type: "string" } },
    };
    const rows = buildRows(
      input({
        effective: page,
        rootSchema: {
          type: "object",
          properties: { name: { type: "string" } },
        },
        localPaths: new Set(["category"]),
      }),
    );
    expect(byName(rows, "name")?.origin).toBe("inherited");
    expect(byName(rows, "category")?.origin).toBe("local");
  });

  test("the tag's own attributes come before inherited ones", () => {
    const rows = buildRows(
      input({
        rootSchema: {
          type: "object",
          properties: { name: { type: "string" } },
        },
        inferred: [info("name", "text"), info("room", "text")],
      }),
    );
    expect(rows.map((r) => r.name)).toEqual(["room", "name"]);
  });

  test("inferred attributes have no schema yet, only a suggestion", () => {
    const rows = buildRows(input({ inferred: [info("room", "text")] }));
    expect(byName(rows, "room")).toMatchObject({
      origin: "inferred",
      schema: null,
      suggested: { type: "string" },
    });
  });

  test("a record's dotted children are not attributes of their own", () => {
    const rows = buildRows(
      input({
        inferred: [info("address", "record"), info("address.city", "text")],
      }),
    );
    expect(rows.map((r) => r.name)).toEqual(["address"]);
  });

  test("system attributes are left out", () => {
    const rows = buildRows(
      input({ inferred: [info("ref", "text", { system: true })] }),
    );
    expect(byName(rows, "ref")).toBeUndefined();
  });

  test("present and invalid counts come from the samples", () => {
    const rows = buildRows(
      input({
        effective: {
          type: "object",
          properties: {
            status: { type: "string", enum: ["planned", "active", "done"] },
          },
        },
        samples: [{ status: "active" }, { status: "doing" }, {}],
      }),
    );
    expect(byName(rows, "status")).toMatchObject({
      present: 2,
      sampled: 3,
      invalid: 1,
    });
  });

  test("required follows the schema's required list", () => {
    const rows = buildRows(
      input({
        effective: {
          type: "object",
          properties: { title: { type: "string" } },
          required: ["title"],
        },
      }),
    );
    expect(byName(rows, "title")?.required).toBe(true);
  });
});

describe("inferredSchema", () => {
  test("display types map to JSON Schema", () => {
    expect(inferredSchema(info("a", "text"))).toEqual({ type: "string" });
    expect(inferredSchema(info("a", "number"))).toEqual({ type: "number" });
    expect(inferredSchema(info("a", "boolean"))).toEqual({ type: "boolean" });
    expect(inferredSchema(info("a", "date"))).toEqual({
      type: "string",
      format: "date",
    });
    expect(inferredSchema(info("a", "datetime"))).toEqual({
      type: "string",
      format: "date-time",
    });
    expect(inferredSchema(info("a", "pagelink"))).toEqual({
      type: "string",
      format: "ref",
    });
    expect(inferredSchema(info("a", "url"))).toEqual({
      type: "string",
      format: "uri",
    });
    expect(inferredSchema(info("a", "list"))).toEqual({
      type: "array",
      items: { type: "string" },
    });
    expect(inferredSchema(info("a", "record"))).toEqual({ type: "object" });
    expect(
      inferredSchema(info("a", "enum", { enumValues: ["x", "y"] })),
    ).toEqual({ type: "string", enum: ["x", "y"] });
  });

  test("mixed values keep their constituent types", () => {
    expect(
      inferredSchema(info("a", "mixed", { mixed: { number: 3, text: 2 } })),
    ).toEqual({ anyOf: [{ type: "number" }, { type: "string" }] });
  });
});

describe("schemaFor", () => {
  test("the first schema keeps the chosen tag attributes and makes nothing required", () => {
    const rows = buildRows(
      input({
        rootSchema: {
          type: "object",
          properties: { name: { type: "string" } },
        },
        effective: null,
        inferred: [
          info("name", "text"),
          info("date", "date"),
          info("room", "text"),
        ],
      }),
    );
    const kept = new Set(["date", "name"]);
    expect(schemaFor(rows, (r) => kept.has(r.name))).toEqual({
      type: "object",
      properties: { date: { type: "string", format: "date" } },
    });
  });

  test("the current schema leaves out removed and undeclared attributes", () => {
    const rows = withDraft(
      buildRows(
        input({
          effective: {
            type: "object",
            properties: {
              status: { type: "string" },
              owner: { type: "string" },
            },
            required: ["status", "owner"],
          },
          inferred: [info("room", "text")],
        }),
      ),
      {
        rules: new Map([["owner", null]]),
        renamed: new Map(),
        required: new Map(),
        resets: new Set(),
      },
    );
    expect(schemaFor(rows)).toEqual({
      type: "object",
      properties: { status: { type: "string" } },
      required: ["status"],
    });
  });
});

describe("withDraft", () => {
  const rows = buildRows(
    input({
      effective: {
        type: "object",
        properties: { status: { type: "string" }, owner: { type: "string" } },
        required: ["status"],
      },
      inferred: [info("room", "text")],
    }),
  );
  const draft = () => ({
    rules: new Map<string, any>(),
    renamed: new Map<string, string>(),
    required: new Map<string, boolean>(),
    resets: new Set<string>(),
  });

  test("without a draft the rows are unchanged", () => {
    expect(withDraft(rows, undefined)).toEqual(rows);
  });

  test("edits, removals, renames, requirements and additions show", () => {
    const d = draft();
    d.rules.set("status", { type: "string", enum: ["a"] });
    d.rules.set("owner", null);
    d.renamed.set("room", "place");
    d.rules.set("place", { type: "string" });
    d.required.set("status", false);
    d.rules.set("budget", { type: "number" });
    const out = withDraft(rows, d);
    expect(byName(out, "status")).toMatchObject({
      schema: { type: "string", enum: ["a"] },
      required: false,
      edited: true,
    });
    expect(byName(out, "owner")?.removed).toBe(true);
    expect(byName(out, "place")).toMatchObject({
      renamedFrom: "room",
      schema: { type: "string" },
    });
    expect(byName(out, "room")).toBeUndefined();
    expect(byName(out, "budget")).toMatchObject({
      added: true,
      origin: "local",
      schema: { type: "number" },
    });
  });
});

import { describe, expect, test } from "vitest";
import { CONFIG_UNSET } from "../config.ts";
import { MANAGED_MARKER, SCHEMAS_MARKER } from "./config_block.ts";
import { applySchemaChanges, readSchemaBlock } from "./schema_block.ts";

const fence = (inner: string) => `\`\`\`space-lua\n${inner}\n\`\`\``;
const CONFIG = `# Config\n\n${fence(`${MANAGED_MARKER}\nconfig.set("a", 1)`)}\n\n## Notes\nKeep me.\n`;
const PATH = ["tags", "page", "schema", "properties", "category"];

const none = { define: {}, set: [], reset: [], require: [] };

describe("applySchemaChanges", () => {
  test("a new block goes right after the configuration block, with priority -10", () => {
    const text = applySchemaChanges(CONFIG, {
      ...none,
      define: { meeting: { type: "object", properties: {} } },
    });
    const config = text.indexOf(MANAGED_MARKER);
    const schemas = text.indexOf(SCHEMAS_MARKER);
    expect(schemas).toBeGreaterThan(config);
    expect(schemas).toBeLessThan(text.indexOf("## Notes"));
    expect(text).toContain(`${SCHEMAS_MARKER}\n-- priority: -10\n`);
    expect(readSchemaBlock(text).defines.meeting).toEqual({
      type: "object",
      properties: {},
    });
  });

  test("without a configuration block the schemas block is appended", () => {
    const text = applySchemaChanges("# Config\n", {
      ...none,
      require: [{ tag: "page", attribute: "x", required: true }],
    });
    expect(text.startsWith("# Config\n")).toBe(true);
    expect(text).toContain(SCHEMAS_MARKER);
  });

  test("a define replaces the statement for its tag and never duplicates", () => {
    let text = applySchemaChanges(CONFIG, {
      ...none,
      define: { meeting: { type: "object" } },
    });
    text = applySchemaChanges(text, {
      ...none,
      define: {
        meeting: { type: "object", properties: { room: { type: "string" } } },
      },
    });
    expect(text.match(/tag\.define/g)).toHaveLength(1);
    expect(readSchemaBlock(text).defines.meeting.properties?.room).toEqual({
      type: "string",
    });
  });

  test("a set replaces the statement for the same path; reset removes it", () => {
    let text = applySchemaChanges(CONFIG, {
      ...none,
      set: [{ path: PATH, value: { type: "string" } }],
    });
    text = applySchemaChanges(text, {
      ...none,
      set: [{ path: PATH, value: { type: "number" } }],
    });
    expect(readSchemaBlock(text).sets).toEqual([
      { path: PATH, value: { type: "number" } },
    ]);
    text = applySchemaChanges(text, { ...none, reset: [PATH] });
    expect(readSchemaBlock(text).sets).toEqual([]);
  });

  test("an unset suppresses with config.unset", () => {
    const text = applySchemaChanges(CONFIG, {
      ...none,
      set: [{ path: PATH, value: CONFIG_UNSET }],
    });
    expect(text).toContain("config.unset");
    expect(readSchemaBlock(text).sets).toEqual([
      { path: PATH, value: CONFIG_UNSET },
    ]);
  });

  test("require statements are replaced per tag and attribute, and can be dropped", () => {
    let text = applySchemaChanges(CONFIG, {
      ...none,
      require: [
        { tag: "page", attribute: "x", required: true },
        { tag: "page", attribute: "y", required: true },
      ],
    });
    text = applySchemaChanges(text, {
      ...none,
      require: [{ tag: "page", attribute: "x", required: false }],
    });
    expect(readSchemaBlock(text).requires).toEqual([
      { tag: "page", attribute: "x", required: false },
      { tag: "page", attribute: "y", required: true },
    ]);
    text = applySchemaChanges(text, {
      ...none,
      resetRequire: [{ tag: "page", attribute: "x" }],
    });
    expect(readSchemaBlock(text).requires).toEqual([
      { tag: "page", attribute: "y", required: true },
    ]);
  });

  test("unrelated bytes, comments, other blocks and opaque statements are untouched", () => {
    const block = fence(
      `${SCHEMAS_MARKER}\n-- priority: -10\n-- my note\nlocal x = 1\nconfig.set(${JSON.stringify("tags.page.schema.properties.category")}, schema.string())`,
    );
    const text = `${CONFIG}\n${block}\n\nTail text.\n`;
    const out = applySchemaChanges(text, {
      ...none,
      set: [{ path: PATH, value: { type: "number" } }],
    });
    expect(out).toContain("-- my note\nlocal x = 1\n");
    expect(out).toContain('config.set("a", 1)');
    expect(out.endsWith("\n\nTail text.\n")).toBe(true);
    expect(out.startsWith("# Config\n\n")).toBe(true);
    expect(readSchemaBlock(out).sets).toEqual([
      { path: PATH, value: { type: "number" } },
    ]);
  });

  test("a block left with only its header is removed", () => {
    const text = applySchemaChanges(CONFIG, {
      ...none,
      set: [{ path: PATH, value: { type: "string" } }],
    });
    expect(applySchemaChanges(text, { ...none, reset: [PATH] })).toBe(CONFIG);
  });

  test("an invalid schemas block refuses to apply and reading reports the error", () => {
    const text = `${CONFIG}\n${fence(`${SCHEMAS_MARKER}\ntag.define {`)}\n`;
    expect(() =>
      applySchemaChanges(text, {
        ...none,
        define: { meeting: { type: "object" } },
      }),
    ).toThrow(/not valid Lua/);
    expect(readSchemaBlock(text).error).toBeDefined();
  });
});

describe("readSchemaBlock", () => {
  test("no block reads as nothing owned", () => {
    expect(readSchemaBlock(CONFIG)).toEqual({
      defines: {},
      sets: [],
      requires: [],
    });
  });
});

describe("review fixes", () => {
  const block = (inner: string) =>
    `${CONFIG}\n${fence(`${SCHEMAS_MARKER}\n-- priority: -10\n${inner}`)}\n`;

  test("an owned define with other fields keeps them and its comments; only the schema changes", () => {
    const text = block(
      'tag.define {\n  name = "book",\n  tagPage = "Books", -- my index\n  transform = function(o) return o end,\n  schema = { type = "object" },\n}',
    );
    const out = applySchemaChanges(text, {
      ...none,
      define: {
        book: { type: "object", properties: { title: { type: "string" } } },
      },
    });
    expect(out).toContain('tagPage = "Books", -- my index');
    expect(out).toContain("transform = function(o) return o end");
    expect(readSchemaBlock(out).defines.book).toEqual({
      type: "object",
      properties: { title: { type: "string" } },
    });
  });

  test("a define without a schema is kept, and a schema is added beside it", () => {
    const text = block('tag.define { name = "book", tagPage = "Books" }');
    const out = applySchemaChanges(text, {
      ...none,
      define: { book: { type: "object" } },
    });
    expect(out).toContain('tag.define { name = "book", tagPage = "Books" }');
    expect(readSchemaBlock(out).defines.book).toEqual({ type: "object" });
  });

  test("two writes to one path keep the last; a write wins over a reset of the same path", () => {
    let text = applySchemaChanges(CONFIG, {
      ...none,
      set: [{ path: PATH, value: { type: "string" } }],
    });
    text = applySchemaChanges(text, {
      ...none,
      set: [
        { path: PATH, value: CONFIG_UNSET },
        { path: PATH, value: { type: "number" } },
      ],
      reset: [PATH],
    });
    expect(readSchemaBlock(text).sets).toEqual([
      { path: PATH, value: { type: "number" } },
    ]);
  });
});

describe("removing statements", () => {
  test("an indented statement goes with its whole line, and a block with comments left stays", () => {
    const text = `${CONFIG}\n${fence(`${SCHEMAS_MARKER}\n-- priority: -10\n  tag.setRequired("page", "x", true)\n-- keep me`)}\n`;
    const out = applySchemaChanges(text, {
      ...none,
      resetRequire: [{ tag: "page", attribute: "x" }],
    });
    expect(out).toContain(
      `${SCHEMAS_MARKER}\n-- priority: -10\n-- keep me\n\`\`\``,
    );
  });
});

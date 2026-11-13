import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { loadConfig } from "../../boot_config.ts";
import { extractSpaceLuaFromPageText } from "../../space_lua_blocks_test_util.ts";
import { buildSchemaIndex } from "./schema.ts";

describe("buildSchemaIndex", () => {
  test("groups ui fields by category, highest priority first", () => {
    const index = buildSchemaIndex({
      schemas: {
        type: "object",
        properties: {
          a: { type: "boolean", ui: { category: "Editor", priority: 1 } },
          b: { type: "boolean", ui: { category: "Editor", priority: 5 } },
          c: { type: "string", ui: { category: "Sync" } },
          hidden: { type: "string" },
        },
      },
      values: {},
      categories: { Sync: { name: "Sync", priority: 10 } },
    });
    expect(index.sortedCategoryNames).toEqual(["Sync", "Editor"]);
    expect(index.categoryMap.Editor.map((f) => f.path)).toEqual(["b", "a"]);
  });

  test("a parent whose children have a ui is not a field itself", () => {
    const index = buildSchemaIndex({
      schemas: {
        type: "object",
        properties: {
          vim: {
            type: "object",
            ui: { category: "Editor" },
            properties: {
              enabled: { type: "boolean", ui: { category: "Editor" } },
            },
          },
        },
      },
      values: {},
      categories: {},
    });
    expect(index.categoryMap.Editor.map((f) => f.path)).toEqual([
      "vim.enabled",
    ]);
  });
});

test("Std's markupBar options are Editor booleans in the Configuration tab", async () => {
  const lua = [
    "libraries/Library/Std/APIs/Schema.md",
    "libraries/Library/Std/Config.md",
  ]
    .map((path) => extractSpaceLuaFromPageText(readFileSync(path, "utf8")))
    .join("\n");
  const config = await loadConfig([{ ref: "test", code: lua }], {}, false);
  const index = buildSchemaIndex({
    schemas: config.schemas,
    values: {},
    categories: {},
  });
  const fields = index.categoryMap.Editor.filter((f) =>
    f.path.startsWith("markupBar."),
  );
  expect(fields.map((f) => f.path)).toEqual([
    "markupBar.selectionBubble",
    "markupBar.lineHandle",
  ]);
  for (const f of fields) {
    expect(f.schema.type).toBe("boolean");
    expect(f.schema.default).toBe(true);
  }
  expect(() => config.set("markupBar.lineHandle", false)).not.toThrow();
  expect(() => config.set("markupBar.other", true)).toThrow();
});

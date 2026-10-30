import { describe, expect, test } from "vitest";
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

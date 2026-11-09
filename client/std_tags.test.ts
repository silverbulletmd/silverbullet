import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { loadConfig } from "./boot_config.ts";
import { extractSpaceLuaFromPageText } from "./space_lua_blocks_test_util.ts";

const STD = "libraries/Library/Std";

async function stdTagConfig(extraLua = "", rootTags = true) {
  const pages = [
    `${STD}/APIs/Schema.md`,
    `${STD}/Config.md`,
    `${STD}/APIs/Tag.md`,
    ...(rootTags ? [`${STD}/Infrastructure/Root Tags.md`] : []),
  ];
  const lua = pages
    .map((path) => extractSpaceLuaFromPageText(readFileSync(path, "utf8")))
    .join("\n");
  return loadConfig([{ ref: "test", code: `${lua}\n${extraLua}` }], {}, false);
}

test("built-in tags have icons", async () => {
  const config = await stdTagConfig();
  expect(config.get(["tags", "page", "icon"], undefined)).toBe("file-text");
  expect(config.get(["tags", "task", "icon"], undefined)).toBe("check-square");
});

test("tag.define accepts a string icon and rejects any other", async () => {
  const config = await stdTagConfig(
    `tag.define { name = "book", icon = "book" }`,
  );
  expect(config.get(["tags", "book", "icon"], undefined)).toBe("book");
  expect(() => config.set(["tags", "book", "icon"], 5)).toThrow(/icon/);
});

test("page and task are pinned by default", async () => {
  const config = await stdTagConfig();
  expect(config.get("workbench.pinnedTags", undefined)).toEqual([
    "page",
    "task",
  ]);
});

test("setRequired adds once and removes only that name", async () => {
  const config = await stdTagConfig(`
    tag.define { name = "book", schema = { type = "object", required = {"title"} } }
    tag.setRequired("book", "author", true)
    tag.setRequired("book", "author", true)
    tag.setRequired("book", "title", false)
  `);
  expect(config.get(["tags", "book", "schema", "required"], undefined)).toEqual(
    ["author"],
  );
});

test("setRequired before the tag has a schema creates an object schema", async () => {
  const config = await stdTagConfig(`tag.setRequired("idea", "area", true)`);
  expect(config.get(["tags", "idea", "schema"], undefined)).toEqual({
    type: "object",
    required: ["area"],
  });
});

test("at bootstrap, targeted writes work before Root Tags has run", async () => {
  const config = await stdTagConfig(
    `
    config.set({"tags", "page", "schema", "properties", "category"}, { type = "string" })
    tag.setRequired("page", "category", true)
  `,
    false,
  );
  expect(
    config.get(["tags", "page", "schema", "properties", "category"], undefined),
  ).toEqual({ type: "string" });
  expect(config.get(["tags", "page", "schema", "required"], undefined)).toEqual(
    ["category"],
  );
});

test("after Root Tags, the same writes extend the built-in page schema", async () => {
  const config = await stdTagConfig(`
    config.set({"tags", "page", "schema", "properties", "category"}, { type = "string" })
    tag.setRequired("page", "category", true)
  `);
  const page = config.get<any>(["tags", "page", "schema"], {});
  expect(page.properties.category).toEqual({ type: "string" });
  expect(page.properties.name).toBeDefined();
  expect(page.required).toContain("category");
});

import { expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexTables } from "./table.ts";

const testPage = `
| name | age |
|----------|----------|
| Frank | 20 |
| Fred | 21 |
`.trim();

test("Test table indexing", async () => {
  createMockSystem();

  const tree = parseMarkdown(testPage);
  const frontmatter = extractFrontMatter(tree);

  const pageMeta: PageMeta = {
    ref: "test",
    name: "test",
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };

  const datas = await indexTables(pageMeta, frontmatter, tree);
  expect(datas.length).toEqual(2);
  expect(datas[0].name).toEqual("Frank");
  expect(datas[0].age).toEqual("20");
  expect(datas[1].name).toEqual("Fred");
  expect(datas[1].age).toEqual("21");
});

test("a `range` column does not overwrite the row's source offsets", async () => {
  createMockSystem();
  // A table of date ranges is an entirely reasonable thing to write; the
  // column must not land on the row object's own offsets (#2028).
  const md = `
| name | range |
|----------|----------|
| Frank | 0, 36 |
`.trim();
  const tree = parseMarkdown(md);
  const frontmatter = extractFrontMatter(tree);
  const pageMeta: PageMeta = {
    ref: "test",
    name: "test",
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };

  const rows = await indexTables(pageMeta, frontmatter, tree);
  expect(rows).toHaveLength(1);
  const row = rows[0] as any;
  expect(row.name).toEqual("Frank");
  expect(Array.isArray(row.range)).toBe(true);
  expect(row.range.every((n: unknown) => typeof n === "number")).toBe(true);
  expect(md.slice(row.range[0], row.range[1])).toContain("Frank");
  expect(typeof row.pos).toBe("number");
});

test("identity columns do not hijack the row object", async () => {
  createMockSystem();
  // Baking a query over pages writes its result back as a table, so the
  // header carries the object's own attribute names. Letting those land on
  // the row re-types it as a `page` owning `[[ADR]]`'s ref, which overwrites
  // that page's real `tags` with the string "{}" and breaks every picker.
  const md = `
| name | ref | tag | tags | itags |
|----------|----------|----------|----------|----------|
| ADR | [[ADR]] | page | {} | page |
`.trim();
  const tree = parseMarkdown(md);
  const frontmatter = extractFrontMatter(tree);
  const pageMeta: PageMeta = {
    ref: "test",
    name: "test",
    tag: "page",
    created: "",
    lastModified: "",
    perm: "rw",
  };

  const rows = await indexTables(pageMeta, frontmatter, tree);
  expect(rows).toHaveLength(1);
  const row = rows[0] as any;

  expect(row.name).toEqual("ADR");
  expect(row.tag).toEqual("table");
  expect(row.ref).toEqual(`test@${row.pos}`);
  expect(Array.isArray(row.tags)).toBe(true);
  expect(row.page).toEqual("test");
});

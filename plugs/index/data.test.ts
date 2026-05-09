import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { extractFrontMatter } from "./frontmatter.ts";
import { indexData } from "./data.ts";

const testPage = `
Some test

\`\`\`#superduper
name: Pete
age: 100
\`\`\`

\`\`\`#superduper
name: Hank
age: 101
\`\`\`
`.trim();

const defaultPageMeta: PageMeta = {
  ref: "Page",
  name: "Page",
  tag: "page",
  created: "",
  lastModified: "",
  perm: "rw",
};

async function indexDataForTest(
  markdown: string,
  pageName = "Page",
): Promise<ObjectValue<any>[]> {
  const meta: PageMeta = { ...defaultPageMeta, ref: pageName, name: pageName };
  const tree = parseMarkdown(markdown);
  const frontmatter = extractFrontMatter(tree);
  return indexData(meta, frontmatter, tree);
}

test("Test indexers", async () => {
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

  const datas: ObjectValue<any>[] = await indexData(
    pageMeta,
    frontmatter,
    tree,
  );
  // 1 data 1 tag
  expect(datas.length).toEqual(3);

  // data object first
  expect(datas[0].tag).toEqual("superduper");
  expect(datas[0].itags).toEqual(["superduper", "data"]);
  expect(datas[0].name).toEqual("Pete");
  expect(datas[0].age).toEqual(100);

  // data object first
  expect(datas[1].tag).toEqual("superduper");
  expect(datas[1].itags).toEqual(["superduper", "data"]);
  expect(datas[1].name).toEqual("Hank");
  expect(datas[1].age).toEqual(101);
});

describe("$ref anchor in fenced data blocks", () => {
  test("$ref field becomes ref and is stripped from the object", async () => {
    createMockSystem();
    const md = `\`\`\`#person\nname: Pete\n$ref: pete\n\`\`\``;
    const results = await indexDataForTest(md);
    const person = results.find((o) => o.tag === "person")!;
    expect(person).toBeTruthy();
    expect(person.tag).toBe("person");
    expect(person.ref).toBe("pete");
    expect(person.name).toBe("Pete");
    expect("$ref" in person).toBe(false);
  });

  test("regression: block without $ref retains Page@docStart ref", async () => {
    createMockSystem();
    const md = `\`\`\`#person\nname: Alice\n\`\`\``;
    const results = await indexDataForTest(md, "Page");
    const person = results.find((o) => o.tag === "person")!;
    expect(person).toBeTruthy();
    expect(person.ref).toMatch(/^Page@\d+$/);
  });

  test("invalid $ref (digit-leading) is ignored; ref falls back to Page@docStart", async () => {
    createMockSystem();
    const md = `\`\`\`#person\nname: Bob\n$ref: 1bad\n\`\`\``;
    const results = await indexDataForTest(md, "Page");
    const person = results.find((o) => o.tag === "person")!;
    expect(person).toBeTruthy();
    expect(person.ref).toMatch(/^Page@\d+$/);
    expect("$ref" in person).toBe(false);
  });
});

describe("range covers the YAML content, not the fence markers", () => {
  test("single-doc block: range bounds the inner YAML exactly", async () => {
    createMockSystem();
    const content = "name: Pete\nage: 100";
    const md = `\`\`\`#person\n${content}\n\`\`\``;
    const results = await indexDataForTest(md, "Page");
    const person = results.find((o) => o.tag === "person")!;
    const [from, to] = person.range as [number, number];
    expect(md.slice(from, to)).toBe(content);
    // sanity: not picking up the fence markers
    expect(md.slice(from, to)).not.toContain("```");
  });

  test("multi-doc block: doc 1 starts after doc 0's end + separator length", async () => {
    createMockSystem();
    const md = [
      "```#person",
      "name: Pete",
      "age: 100",
      "---",
      "name: Hank",
      "age: 101",
      "```",
    ].join("\n");
    const results = await indexDataForTest(md, "Page");
    const persons = results.filter((o) => o.tag === "person");
    expect(persons).toHaveLength(2);
    const [a, b] = persons;
    expect(b.range[0]).toBe(a.range[1] + "---".length);
    expect(md.slice(a.range[0], a.range[1])).toContain("Pete");
    expect(md.slice(b.range[0], b.range[1])).toContain("Hank");
  });
});

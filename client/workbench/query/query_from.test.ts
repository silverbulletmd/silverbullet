import { toolPageLua } from "@silverbulletmd/silverbullet/lib/tool_pages";
import { describe, expect, test } from "vitest";
import {
  canNarrow,
  dataRootSource,
  listedSource,
  type QuerySource,
  rootSource,
  sameSource,
  sampleQuery,
  sourceFor,
  sourceFromCall,
  sourceLabel,
  sourceLua,
  tagSource,
} from "./query_from.ts";

const contentPages: QuerySource = {
  root: "page",
  tag: null,
  by: "root",
  scope: "content",
};
const toolPages: QuerySource = { ...contentPages, scope: "tool" };

describe("sourceLua", () => {
  test("a root tag reads through its own helper, narrowed by a user tag", () => {
    expect(sourceLua(rootSource("page"))).toBe("index.pages()");
    expect(sourceLua({ root: "task", tag: "work", by: "root" })).toBe(
      'index.tasks("work")',
    );
    expect(sourceLua({ root: "item", tag: "work", by: "tag" })).toBe(
      'index.items("work")',
    );
  });

  test("pages can be only content pages or only tool pages", () => {
    expect(sourceLua(contentPages)).toBe("index.contentPages()");
    expect(sourceLua({ ...contentPages, tag: "adr" })).toBe(
      'index.contentPages("adr")',
    );
    expect(sourceLua(toolPages)).toBe("index.toolPages()");
    expect(sourceLua({ ...toolPages, tag: "food" })).toBe(
      'index.toolPages("food")',
    );
  });

  test("a user tag on its own spans every root tag", () => {
    expect(sourceLua(tagSource("work"))).toBe('index.objects("work")');
  });

  test("data blocks and relations narrow by their own argument", () => {
    expect(sourceLua(dataRootSource("contact"))).toBe('index.data("contact")');
    expect(sourceLua({ root: "relation", tag: "spouse", by: "root" })).toBe(
      'index.relations("spouse")',
    );
  });

  test("tags without a narrowing helper", () => {
    expect(sourceLua(rootSource("document"))).toBe("index.documents()");
    expect(sourceLua(rootSource("aspiring-page"))).toBe(
      "index.aspiringPages()",
    );
    expect(sourceLua(rootSource("anchor"))).toBe('index.objects("anchor")');
    expect(canNarrow("document")).toBe(false);
    expect(canNarrow("anchor")).toBe(false);
    expect(canNarrow("task")).toBe(true);
  });

  test("every generated call reads back as the same source", () => {
    for (const s of [
      rootSource("page"),
      { root: "task", tag: "work", by: "root" as const },
      dataRootSource("contact"),
      rootSource("document"),
      rootSource("anchor"),
      tagSource("work"),
      contentPages,
      { ...toolPages, tag: "food" },
    ]) {
      const m = /^index\.(\w+)\((?:"(.*)")?\)$/.exec(sourceLua(s))!;
      expect(sourceFromCall(m[1], m[2] ?? null)).toEqual(s);
    }
  });
});

test("sourceFor: built-in tags are roots, others user tags", () => {
  expect(sourceFor("task")).toEqual(rootSource("task"));
  expect(sourceFor("work")).toEqual(tagSource("work"));
});

test("listedSource: page in the tag list means content pages", () => {
  expect(listedSource("page")).toEqual(contentPages);
  expect(listedSource("task")).toEqual(rootSource("task"));
});

test("sameSource tells the page scopes apart", () => {
  expect(sameSource(contentPages, rootSource("page"))).toBe(false);
  expect(sameSource(contentPages, toolPages)).toBe(false);
  expect(sameSource(contentPages, { ...contentPages })).toBe(true);
});

test("sourceLabel", () => {
  expect(sourceLabel(contentPages)).toBe("content page");
  expect(sourceLabel({ ...toolPages, tag: "food" })).toBe(
    "tool page tagged #food",
  );
  expect(sourceLabel(rootSource("task"))).toBe("task");
  expect(sourceLabel(tagSource("work"))).toBe("#work");
  expect(sourceLabel({ root: "task", tag: "work", by: "tag" })).toBe(
    "task tagged #work",
  );
});

describe("sampleQuery", () => {
  test("samples the entries the source reads", () => {
    expect(sampleQuery(rootSource("page"))).toEqual({ key: "page" });
    expect(sampleQuery(tagSource("work"))).toEqual({ key: "work" });
    expect(sampleQuery({ root: "task", tag: "work", by: "root" })).toEqual({
      key: "work",
      where: 'o.tag == "task"',
    });
    expect(
      sampleQuery({ root: "relation", tag: "spouse", by: "root" }),
    ).toEqual({ key: "relation", where: 'o.kind == "spouse"' });
    expect(sampleQuery(dataRootSource("contact")).key).toBe("contact");
  });

  test("samples only the page scope's pages", () => {
    const tool = toolPageLua("o");
    expect(sampleQuery(contentPages)).toEqual({
      key: "page",
      where: `not (${tool})`,
    });
    expect(sampleQuery({ ...toolPages, tag: "food" })).toEqual({
      key: "food",
      where: `o.tag == "page" and ${tool}`,
    });
  });
});

import { describe, expect, test } from "vitest";
import {
  allEntries,
  buildTagList,
  filterTagList,
  narrowingTags,
  type TagListInput,
  tagIcon,
} from "./tag_list.ts";

const schema = { type: "object", properties: {} };

function input(extra: Partial<TagListInput> = {}): TagListInput {
  return {
    records: [
      { name: "page" },
      { name: "task" },
      { name: "link" },
      { name: "item" },
      { name: "project", parent: "page" },
      { name: "meeting", parent: "page" },
      { name: "idea", parent: "task" },
      { name: "contact", parent: "data" },
    ],
    definitions: {
      page: { schema, icon: "file-text" },
      task: { schema, icon: "check-square" },
      link: { schema },
      item: { schema },
      project: { schema, pageDecoration: { icon: "briefcase" } },
      glossary: { schema },
      contact: { schema },
    },
    counts: {
      page: 312,
      task: 120,
      link: 40,
      item: 240,
      project: 42,
      meeting: 17,
      idea: 6,
      contact: 4,
    },
    pinned: ["page", "task"],
    ...extra,
  };
}

const names = (entries: { name: string }[]) => entries.map((e) => e.name);

describe("buildTagList", () => {
  test("pinned tags come first in pin order and are not repeated", () => {
    const list = buildTagList(input({ pinned: ["task", "page", "project"] }));
    expect(names(list.pinned)).toEqual(["task", "page", "project"]);
    expect(names(list.defined)).not.toContain("project");
    expect(names(list.builtIn)).not.toContain("page");
  });

  test("user tags split by schema, most objects first", () => {
    const list = buildTagList(input());
    expect(names(list.defined)).toEqual(["project", "contact", "glossary"]);
    expect(names(list.noSchema)).toEqual(["meeting", "idea"]);
  });

  test("a definition without objects is listed under Defined with count 0", () => {
    const glossary = buildTagList(input()).defined.find(
      (e) => e.name === "glossary",
    );
    expect(glossary?.count).toBe(0);
  });

  test("data-block roots join the split with data: true", () => {
    const contact = buildTagList(input()).defined.find(
      (e) => e.name === "contact",
    );
    expect(contact).toMatchObject({ data: true, defined: true });
    const project = buildTagList(input()).defined.find(
      (e) => e.name === "project",
    );
    expect(project?.data).toBe(false);
  });

  test("built-in tags form one alphabetical list, including link", () => {
    expect(names(buildTagList(input()).builtIn)).toEqual(["item", "link"]);
  });

  test("entries carry icons", () => {
    const list = buildTagList(input());
    expect(list.pinned[0].icon).toBe("file-text");
    expect(list.defined[0].icon).toBe("briefcase");
    expect(list.noSchema[0].icon).toBe("tag");
  });

  test("invalid counts are carried onto entries", () => {
    const list = buildTagList(input({ invalid: { project: 3 } }));
    expect(list.defined[0].invalid).toBe(3);
  });

  test("a pinned tag that doesn't exist is left out", () => {
    const list = buildTagList(input({ pinned: ["page", "gone"] }));
    expect(names(list.pinned)).toEqual(["page"]);
  });
});

describe("narrowing", () => {
  const entries = (records: TagListInput["records"]) =>
    allEntries(
      buildTagList({ records, definitions: {}, counts: {}, pinned: [] }),
    );

  test("each user tag knows the root tags it's used on, in kind order", () => {
    const list = entries([
      { name: "work", parent: "task" },
      { name: "work", parent: "page" },
      { name: "work", parent: "relation" },
      { name: "home", parent: "item" },
    ]);
    expect(list.find((e) => e.name === "work")?.roots).toEqual([
      "page",
      "task",
      "relation",
    ]);
    expect(narrowingTags(list, "task")).toEqual(["work"]);
    expect(narrowingTags(list, "item")).toEqual(["home"]);
  });

  test("data offers the root tags data blocks define, not as a root of their own", () => {
    const list = entries([
      { name: "expense", parent: "data" },
      { name: "contact", parent: "data" },
      { name: "contact", parent: "item" },
    ]);
    expect(narrowingTags(list, "data")).toEqual(["contact", "expense"]);
    expect(list.find((e) => e.name === "contact")?.roots).toEqual(["item"]);
    expect(narrowingTags(list, "item")).toEqual(["contact"]);
  });

  test("built-in tags are never offered", () => {
    const list = entries([{ name: "task", parent: "page" }, { name: "page" }]);
    expect(narrowingTags(list, "page")).toEqual([]);
  });
});

describe("filterTagList", () => {
  test("filtering keeps every section and matches case-insensitively, ignoring #", () => {
    const list = filterTagList(buildTagList(input()), "#PRO");
    expect(names(list.defined)).toEqual(["project"]);
    expect(list.noSchema).toEqual([]);
    expect(list.builtIn).toEqual([]);
    expect(list.pinned).toEqual([]);
  });

  test("an empty phrase keeps everything", () => {
    const list = buildTagList(input());
    expect(filterTagList(list, "  ")).toEqual(list);
  });
});

test("allEntries lists the sections in order", () => {
  expect(names(allEntries(buildTagList(input())))).toEqual([
    "page",
    "task",
    "project",
    "contact",
    "glossary",
    "meeting",
    "idea",
    "item",
    "link",
  ]);
});

describe("tagIcon", () => {
  test("a tag's own icon wins", () => {
    expect(tagIcon({ page: { icon: "file-text" } }, "page")).toBe("file-text");
    expect(
      tagIcon(
        { book: { icon: "star", pageDecoration: { icon: "book" } } },
        "book",
      ),
    ).toBe("star");
  });

  test("without an icon, the page decoration's icon is used", () => {
    expect(
      tagIcon({ book: { pageDecoration: { icon: "book" } } }, "book"),
    ).toBe("book");
  });

  test("a tag without either gets the tag icon", () => {
    expect(tagIcon({}, "unknown")).toBe("tag");
  });
});

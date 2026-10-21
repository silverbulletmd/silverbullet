import { describe, expect, test } from "vitest";
import {
  type QueryTemplate,
  templateDefinitions,
  templateList,
  templatesFor,
} from "./query_templates.ts";

// Made-up scripts, the way a space-lua block defines templates
const LIBRARY = `
--- Renders a page as a linked list item.
--- @param p page|aspiring-page
templates.pageItem = template.new([==[
* [[\${name}]]
]==])

--- Renders a task with its checkbox.
--- @param t task
templates.taskItem = template.new([==[
* [\${state}] \${name}
]==])

-- A plain comment is no documentation
templates.plain = template.new("* \${name}")
`;
const MINE = `
--- A book with its author.
--- @param b book
templates["bookLine"] = template.new("* \${name} by \${author}")
local helper = 1
`;

// As the space's script loading records them: the fence's page and position
const SCRIPTS = [
  { ref: "Library/Templates@10", source: LIBRARY },
  { ref: "Mine@0", source: MINE },
  { ref: "Broken@0", source: "this doesn't parse (" },
];
// Where a script's source starts: past its fence line
const sourceAt = (ref: string, offset: number) => {
  const [page, pos] = ref.split("@");
  return {
    path: `${page}.md`,
    details: {
      type: "position",
      pos: Number(pos) + "```space-lua\n".length + offset,
    },
  };
};

describe("templateDefinitions", () => {
  test("reads the --- comments above each templates.x assignment, and where it is", () => {
    const defs = templateDefinitions(SCRIPTS);
    expect(defs.get("pageItem")?.doc).toEqual({
      description: "Renders a page as a linked list item.",
      parameters: [{ name: "p", type: "page|aspiring-page", optional: false }],
    });
    expect(defs.get("pageItem")?.ref).toEqual(
      sourceAt("Library/Templates@10", LIBRARY.indexOf("templates.pageItem")),
    );
    expect(defs.get("bookLine")?.doc?.description).toBe(
      "A book with its author.",
    );
    // Undocumented, but defined there all the same
    expect(defs.get("plain")?.doc).toBeUndefined();
    expect(defs.get("plain")?.ref).toEqual(
      sourceAt("Library/Templates@10", LIBRARY.indexOf("templates.plain")),
    );
    expect(defs.has("helper")).toBe(false);
  });
});

describe("templateList", () => {
  test("every template defined, with its description, the types it takes and where", () => {
    const defs = templateDefinitions(SCRIPTS);
    const list = templateList(
      ["taskItem", "plain", "pageItem", "elsewhere"],
      defs,
    );
    expect(list.map(({ definition, ...t }) => t)).toEqual([
      { id: "templates.elsewhere", name: "elsewhere", types: [] },
      {
        id: "templates.pageItem",
        name: "pageItem",
        description: "Renders a page as a linked list item.",
        types: ["page", "aspiring-page"],
      },
      { id: "templates.plain", name: "plain", types: [] },
      {
        id: "templates.taskItem",
        name: "taskItem",
        description: "Renders a task with its checkbox.",
        types: ["task"],
      },
    ]);
    // Defined outside a script's top level: nowhere to jump to
    expect(list[0].definition).toBeUndefined();
    expect(list[1].definition).toEqual(defs.get("pageItem")?.ref);
  });
});

describe("templatesFor", () => {
  const list: QueryTemplate[] = [
    { id: "templates.a", name: "a", types: [] },
    { id: "templates.page", name: "page", types: ["page"] },
    { id: "templates.task", name: "task", types: ["task"] },
  ];

  test("the ones that take the tag's objects first", () => {
    expect(templatesFor(list, "task").map((t) => t.name)).toEqual([
      "task",
      "a",
      "page",
    ]);
  });
});

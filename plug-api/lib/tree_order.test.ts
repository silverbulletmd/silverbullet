import { expect, test } from "vitest";
import {
  compareTreePaths,
  parseTree,
  parseTreeOrder,
  placeSibling,
  renameInTreeOrder,
  renderTreeOrder,
  splitPath,
  TreeIndex,
  type TreeOrder,
  treeOrderPreamble,
} from "./tree_order.ts";

const page = `The order of the space tree. Drag rows in the tree to change it, or edit this list.

* [[Inbox]]
* [[Projects]]
  * [[Projects/Beta]]
  * [[Projects/Alpha]]
* Archive
  * [[Archive/2025]]
`;

test("links decide folder and order", () => {
  const o = parseTreeOrder(page);
  expect(o.get("")).toEqual(["Inbox", "Projects", "Archive"]);
  expect(o.get("Projects")).toEqual(["Beta", "Alpha"]);
  expect(o.get("Archive")).toEqual(["2025"]);
});

test("a plain-text folder follows its children's links", () => {
  const o = parseTreeOrder("* Old\n  * [[New/A]]\n");
  expect(o.get("")).toEqual(["New"]);
  expect(o.get("New")).toEqual(["A"]);
});

test("a link moved under the wrong parent is filed by its target", () => {
  const o = parseTreeOrder("* [[Projects]]\n  * [[Archive/Beta]]\n");
  expect(o.get("")).toEqual(["Projects"]);
  expect(o.get("Archive")).toEqual(["Beta"]);
  expect(o.get("Projects")).toBeUndefined();
});

test("tolerates other bullets, tab/4-space indent, aliases, attributes and stray text", () => {
  const o = parseTreeOrder(
    "intro\n\n- [[A|Alias]] [icon: inbox]\n\t+ [[A/x]]\n    * [[A/y]]\nstray\n* [[B]]\n",
  );
  expect(o.get("")).toEqual(["A", "B"]);
  expect(o.get("A")).toEqual(["x", "y"]);
});

test("only the first top-level list counts", () => {
  expect(parseTreeOrder("* [[A]]\n\n# Later\n\n* [[B]]\n").get("")).toEqual([
    "A",
  ]);
});

test("empty or list-less text gives an empty order", () => {
  expect(parseTreeOrder("").size).toBe(0);
  expect(parseTreeOrder("just text").size).toBe(0);
});

test("preamble is everything before the first top-level item, or all of a list-less text", () => {
  expect(treeOrderPreamble(page)).toBe(
    "The order of the space tree. Drag rows in the tree to change it, or edit this list.\n\n",
  );
  expect(treeOrderPreamble("no list")).toBe("no list\n\n");
  expect(treeOrderPreamble("")).toBe("");
});

test("render is canonical, keeps the preamble and drops missing leaves", () => {
  const order: TreeOrder = new Map([
    ["", ["Inbox", "Gone", "Archive"]],
    ["Archive", ["2025"]],
  ]);
  const exists = new Set(["Inbox", "Archive/2025"]);
  expect(renderTreeOrder("Intro\n\n", order, (p) => exists.has(p))).toBe(
    "Intro\n\n* Inbox\n* Archive\n  * 2025\n",
  );
});

test("render skips a plain folder whose subtree renders nothing", () => {
  const order: TreeOrder = new Map([
    ["", ["Empty"]],
    ["Empty", ["Gone"]],
  ]);
  expect(renderTreeOrder("", order, () => false)).toBe("\n");
});

test("render keeps an existing page-less folder that has no saved sub-order", () => {
  const order: TreeOrder = new Map([["", ["Projects", "Gone", "A"]]]);
  expect(renderTreeOrder("", order, (p) => p === "A" || p === "Projects")).toBe(
    "* Projects\n* A\n",
  );
});

test("parse(render(x)) round-trips", () => {
  const o = parseTreeOrder(page);
  const files = new Set([
    "Inbox",
    "Projects",
    "Projects/Beta",
    "Projects/Alpha",
    "Archive/2025",
  ]);
  const again = parseTreeOrder(
    renderTreeOrder(treeOrderPreamble(page), o, (p) => files.has(p)),
  );
  expect(again).toEqual(o);
});

test("compareTreePaths: unlisted first alphabetically, then listed in order, at every level", () => {
  const order: TreeOrder = new Map([
    ["", ["Projects", "Inbox"]],
    ["Projects", ["B", "A"]],
  ]);
  const c = (a: string, b: string) => a.localeCompare(b);
  const sorted = [
    "Inbox",
    "Projects/A",
    "Zeta",
    "Projects/B",
    "Alpha",
    "Projects",
  ].sort((a, b) => compareTreePaths(a, b, order, c));
  expect(sorted).toEqual([
    "Alpha",
    "Zeta",
    "Projects",
    "Projects/B",
    "Projects/A",
    "Inbox",
  ]);
});

test("placeSibling moves before or after an anchor, or to the end with null", () => {
  expect(placeSibling(["A", "B", "C"], "C", "A", "before")).toEqual([
    "C",
    "A",
    "B",
  ]);
  expect(placeSibling(["A", "B", "C"], "A", "C", "after")).toEqual([
    "B",
    "C",
    "A",
  ]);
  expect(placeSibling(["A", "B"], "X", null, "after")).toEqual(["A", "B", "X"]);
});

test("empty items contribute nothing and do not hang render", () => {
  for (const text of [
    "* [[A]]\n* \n",
    "* [[A]]\n* [x: y]\n",
    "* [[A]]\n* [[ ]]\n",
  ]) {
    const o = parseTreeOrder(text);
    expect(o.get("")).toEqual(["A"]);
    expect(renderTreeOrder("", o, () => true)).toBe("* A\n");
  }
  const o = parseTreeOrder("* [[A]]\n* \n  * [[B]]\n");
  expect(o.get("")).toEqual(["A", "B"]);
});

test("an entry joins only its own folder's list, not its ancestors", () => {
  expect(parseTreeOrder("* [[A/B/C]]\n")).toEqual(new Map([["A/B", ["C"]]]));
});

test("a plain folder resolves to the common folder of all descendant links", () => {
  expect(parseTreeOrder("* X\n  * [[A/x]]\n  * [[A/y]]\n")).toEqual(
    new Map([
      ["", ["A"]],
      ["A", ["x", "y"]],
    ]),
  );
  expect(parseTreeOrder("* Old\n  * Sub\n    * [[New/Sub/C]]\n")).toEqual(
    new Map([
      ["", ["New"]],
      ["New", ["Sub"]],
      ["New/Sub", ["C"]],
    ]),
  );
  const split = parseTreeOrder("* X\n  * [[A/x]]\n  * [[B/y]]\n");
  expect(split.get("")).toEqual(["X"]);
});

test("a plain item with no links and a slash in its text is a full path", () => {
  expect(parseTreeOrder("* [[Inbox]]\n  * Projects/Sub\n")).toEqual(
    new Map([
      ["", ["Inbox"]],
      ["Projects", ["Sub"]],
    ]),
  );
});

test("folders the root walk does not reach are written as top-level groups", () => {
  const order: TreeOrder = new Map([
    ["", ["Inbox"]],
    ["Projects/Sub", ["Sub2", "B"]],
    ["Projects/Sub/Sub2", ["X"]],
    ["Order", ["B", "A"]],
  ]);
  const files = new Set([
    "Inbox",
    "Order/A",
    "Order/B",
    "Projects/Sub/B",
    "Projects/Sub/Sub2/X",
  ]);
  expect(renderTreeOrder("", order, (p) => files.has(p))).toBe(
    [
      "* Inbox",
      "* Order/B",
      "* Order/A",
      "* Projects/Sub/Sub2",
      "  * X",
      "* Projects/Sub/B",
      "",
    ].join("\n"),
  );
});

test("orders without a saved ancestor survive parse(render(x))", () => {
  const files = new Set([
    "Inbox",
    "Order/A",
    "Order/B",
    "Projects/Sub/A",
    "Projects/Sub/B",
    "Projects/Sub/Sub2/X",
  ]);
  const exists = (p: string) =>
    files.has(p) || [...files].some((f) => f.startsWith(`${p}/`));
  const cases: [string, TreeOrder][] = [
    ["nested only", new Map([["Order", ["B", "A"]]])],
    ["deep, no ancestors", new Map([["Projects/Sub", ["B", "A"]]])],
    [
      "root saved, middle not",
      new Map([
        ["", ["Projects", "Inbox", "Order"]],
        ["Projects/Sub", ["B", "A"]],
      ]),
    ],
    [
      "page-less folder in an unreached group",
      new Map([
        ["Projects/Sub", ["Sub2", "B", "A"]],
        ["Projects/Sub/Sub2", ["X"]],
      ]),
    ],
    [
      "page-less folder without its own order in an unreached group",
      new Map([["Projects/Sub", ["B", "Sub2", "A"]]]),
    ],
    [
      "nested page-less folders under the root",
      new Map([
        ["", ["Projects", "Inbox"]],
        ["Projects", ["Sub"]],
        ["Projects/Sub", ["B", "A"]],
      ]),
    ],
  ];
  for (const [name, o] of cases) {
    const once = parseTreeOrder(renderTreeOrder("", o, exists));
    expect(once, name).toEqual(o);
    expect(parseTreeOrder(renderTreeOrder("", once, exists)), name).toEqual(
      once,
    );
  }
});

test("link targets go through the resolver, in visit and in places", () => {
  const known = new Map([
    ["Beta", "Projects/Beta"],
    ["inbox", "Inbox"],
    ["Gamma", "Old/Gamma"],
  ]);
  const resolve = (t: string) => known.get(t) ?? t;
  const o = parseTreeOrder(
    "* [[inbox]]\n* [[Projects]]\n  * [[Beta]]\n* Old\n  * [[Gamma]]\n",
    resolve,
  );
  expect(o.get("")).toEqual(["Inbox", "Projects", "Old"]);
  expect(o.get("Projects")).toEqual(["Beta"]);
  expect(o.get("Old")).toEqual(["Gamma"]);
});

test("names containing brackets parse as links, with or without alias", () => {
  const o = parseTreeOrder(
    "* [[Meeting [Q3] notes]]\n* [[Plan [v2]|the plan]]\n",
  );
  expect(o.get("")).toEqual(["Meeting [Q3] notes", "Plan [v2]"]);
});

test("CRLF text parses like LF text", () => {
  const crlf = page.replace(/\n/g, "\r\n");
  expect(parseTreeOrder(crlf)).toEqual(parseTreeOrder(page));
  expect(treeOrderPreamble(crlf)).toBe(treeOrderPreamble(page));
});

test("TreeIndex lists children in first-seen order, implied folders included", () => {
  const index = new TreeIndex(["B", "A/x", "C/q/r", "A/y", "A"]);
  expect(index.childrenOf("")).toEqual(["B", "A", "C"]);
  expect(index.childrenOf("A")).toEqual(["x", "y"]);
  expect(index.childrenOf("C/q/r")).toEqual([]);
  expect(index.isFolder("C/q")).toBe(true);
  expect(index.isFolder("B")).toBe(false);
  expect(index.neighbor("A", -1)).toBe("B");
  expect(index.neighbor("A", 1)).toBe("C");
  expect(index.neighbor("A/x", -1)).toBeUndefined();
  expect(index.neighbor("missing", 1)).toBeUndefined();
});

test("splitPath splits on the last separator", () => {
  expect(splitPath("a/b/c")).toEqual({ folder: "a/b", name: "c" });
  expect(splitPath("top")).toEqual({ folder: "", name: "top" });
  expect(splitPath("a::b", "::")).toEqual({ folder: "a", name: "b" });
});

test("attributes are kept per resolved path, for pages and plain folders", () => {
  const { order, attributes } = parseTree(
    "* [[Docs]] [icon: book-open]\n  * [[Docs/A]] [hide: true] [x: a:b]\n* Fixtures [hide: true]\n  * [[Fixtures/F]]\n* [x: y]\n",
  );
  expect(order.get("")).toEqual(["Docs", "Fixtures"]);
  expect(attributes.get("Docs")).toEqual({ icon: "book-open" });
  expect(attributes.get("Docs/A")).toEqual({ hide: "true", x: "a:b" });
  expect(attributes.get("Fixtures")).toEqual({ hide: "true" });
  expect(attributes.has("")).toBe(false);
});

test("a rewrite keeps every entry's attributes, wherever the reorder happened", () => {
  const text =
    "intro\n\n* [[Docs]] [icon: book-open]\n  * [[Docs/A]]\n  * [[Docs/B]] [custom: kept]\n* Fixtures [hide: true]\n  * [[Fixtures/F]]\n";
  const { order, attributes } = parseTree(text);
  order.set("Docs", ["B", "A"]);
  const files = new Set(["Docs", "Docs/A", "Docs/B", "Fixtures/F"]);
  const rendered = renderTreeOrder(
    treeOrderPreamble(text),
    order,
    (p) => files.has(p) || p === "Fixtures",
    attributes,
  );
  expect(rendered).toBe(
    "intro\n\n* Docs [icon: book-open]\n  * B [custom: kept]\n  * A\n* Fixtures [hide: true]\n  * F\n",
  );
  expect(parseTree(rendered).attributes).toEqual(attributes);
});

test("plain entries are names under their parent, full paths at the top", () => {
  const { order, attributes } = parseTree(
    "* Projects [icon: folder]\n  * Beta\n  * Sub\n    * X\n* Inbox\n* Archive/2025\n  * Q1\n",
  );
  expect(order).toEqual(
    new Map([
      ["", ["Projects", "Inbox"]],
      ["Projects", ["Beta", "Sub"]],
      ["Projects/Sub", ["X"]],
      ["Archive", ["2025"]],
      ["Archive/2025", ["Q1"]],
    ]),
  );
  expect(attributes.get("Projects")).toEqual({ icon: "folder" });
});

test("an order page written with links reads the same as its plain rewrite", () => {
  const legacy =
    "* [[Projects]]\n  * [[Projects/Beta]] [hide: true]\n* [[Inbox]]\n";
  const before = parseTree(legacy);
  const files = new Set(["Projects", "Projects/Beta", "Inbox"]);
  const plain = renderTreeOrder(
    "",
    before.order,
    (p) => files.has(p),
    before.attributes,
  );
  expect(plain).toBe("* Projects\n  * Beta [hide: true]\n* Inbox\n");
  expect(parseTree(plain)).toEqual(before);
});

/** Applies `renames` to the order `text` describes, in a space holding
 * `after` once they are done; returns the rewritten order page. */
function renamed(text: string, renames: [string, string][], after: string[]) {
  const { order, attributes } = parseTree(text);
  const files = new Set(after);
  const isFolder = (p: string) => after.some((f) => f.startsWith(`${p}/`));
  const exists = (p: string) => files.has(p) || isFolder(p);
  renameInTreeOrder(order, attributes, renames, exists, isFolder);
  return renderTreeOrder("", order, exists, attributes);
}

test("a page renamed within its folder keeps its place and attributes", () => {
  expect(
    renamed("* A\n* B [icon: star]\n* C\n", [["B", "Bee"]], ["A", "Bee", "C"]),
  ).toBe("* A\n* Bee [icon: star]\n* C\n");
});

test("a page moved to another folder leaves its old list", () => {
  expect(
    renamed("* A\n* B\n* P\n  * X\n", [["B", "P/B"]], ["A", "P/B", "P/X"]),
  ).toBe("* A\n* P\n  * X\n");
});

test("a renamed folder takes its order, children and place along", () => {
  expect(
    renamed(
      "* A\n* Projects [icon: folder]\n  * Sub\n    * Y\n    * X\n  * Beta\n* Z\n",
      [
        ["Projects/Beta", "Work/Beta"],
        ["Projects/Sub/X", "Work/Sub/X"],
        ["Projects/Sub/Y", "Work/Sub/Y"],
      ],
      ["A", "Work/Beta", "Work/Sub/X", "Work/Sub/Y", "Z"],
    ),
  ).toBe(
    "* A\n* Work [icon: folder]\n  * Sub\n    * Y\n    * X\n  * Beta\n* Z\n",
  );
});

test("a folder moved under another one keeps its order there", () => {
  expect(
    renamed(
      "* Projects\n  * B\n  * A\n* Archive\n",
      [
        ["Projects/A", "Archive/Projects/A"],
        ["Projects/B", "Archive/Projects/B"],
      ],
      ["Archive/Projects/A", "Archive/Projects/B"],
    ),
  ).toBe("* Archive\n* Archive/Projects/B\n* Archive/Projects/A\n");
});

test("a page with pages under it, renamed in two steps, keeps one place", () => {
  const start = "* A\n* P [icon: star]\n  * Y\n  * X\n* Z\n";
  // How the tree renames it: the pages under it first, then the page itself.
  const mid = renamed(
    start,
    [
      ["P/X", "Q/X"],
      ["P/Y", "Q/Y"],
    ],
    ["A", "P", "Q/X", "Q/Y", "Z"],
  );
  expect(mid).toBe("* A\n* P [icon: star]\n* Q\n  * Y\n  * X\n* Z\n");
  expect(renamed(mid, [["P", "Q"]], ["A", "Q", "Q/X", "Q/Y", "Z"])).toBe(
    "* A\n* Q [icon: star]\n  * Y\n  * X\n* Z\n",
  );
});

test("a page renamed away from the pages under it leaves the folder in place", () => {
  expect(
    renamed(
      "* P\n  * Y\n  * X\n* Z\n",
      [["P", "Page"]],
      ["Page", "P/X", "P/Y", "Z"],
    ),
  ).toBe("* P\n  * Y\n  * X\n* Page\n* Z\n");
});

test("one page moved out of a folder that keeps other content moves nothing else", () => {
  expect(
    renamed(
      "* A\n  * Sub\n    * Y\n    * X\n",
      [["A/Sub/X", "B/Sub/X"]],
      ["A/Sub/Y", "B/Sub/X"],
    ),
  ).toBe("* A\n  * Sub\n    * Y\n");
});

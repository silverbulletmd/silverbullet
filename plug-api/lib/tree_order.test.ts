import { expect, test } from "vitest";
import {
  compareTreePaths,
  parseTreeOrder,
  placeSibling,
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
    "Intro\n\n* [[Inbox]]\n* Archive\n  * [[Archive/2025]]\n",
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
  expect(
    renderTreeOrder(
      "",
      order,
      (p) => p === "A",
      (p) => p === "Projects",
    ),
  ).toBe("* Projects\n* [[A]]\n");
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
    expect(renderTreeOrder("", o, () => true)).toBe("* [[A]]\n");
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
      "* [[Inbox]]",
      "* [[Order/B]]",
      "* [[Order/A]]",
      "* Projects/Sub/Sub2",
      "  * [[Projects/Sub/Sub2/X]]",
      "* [[Projects/Sub/B]]",
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
  const isFile = (p: string) => files.has(p);
  const isFolder = (p: string) => [...files].some((f) => f.startsWith(`${p}/`));
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
    const once = parseTreeOrder(renderTreeOrder("", o, isFile, isFolder));
    expect(once, name).toEqual(o);
    expect(
      parseTreeOrder(renderTreeOrder("", once, isFile, isFolder)),
      name,
    ).toEqual(once);
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

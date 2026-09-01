import { expect, test } from "vitest";
import {
  allFolderPaths,
  allNodes,
  ancestorPaths,
  buildTree,
  computeTreeDisplay,
  findNode,
  flattenVisible,
  nodeObject,
  planMove,
  pruneTree,
  withExpanded,
} from "./tree_model.ts";

const row = (name: string) => ({
  obj: { name },
  primary: name.split("/").pop()!,
});

const prioRow = (name: string, priority: number) => ({
  ...row(name),
  priority,
});

test("builds hierarchy with implicit folders", () => {
  const root = buildTree(
    [row("Projects/Alpha"), row("Projects/Beta"), row("Top")],
    "/",
    true,
  );
  expect(root.children.map((c) => c.path)).toEqual(["Projects", "Top"]);
  const projects = root.children[0];
  expect(projects.isFolder).toBe(true);
  expect(projects.row).toBeUndefined();
  expect(projects.children.map((c) => c.segment)).toEqual(["Alpha", "Beta"]);
});

test("page+folder dual merges", () => {
  const root = buildTree([row("Projects"), row("Projects/Alpha")], "/", true);
  expect(root.children.length).toBe(1);
  expect(root.children[0].isFolder).toBe(true);
  expect(root.children[0].row!.obj.name).toBe("Projects");
});

test("foldersFirst=false preserves source order", () => {
  const root = buildTree([row("Zebra"), row("Projects/Alpha")], "/", false);
  expect(root.children.map((c) => c.path)).toEqual(["Zebra", "Projects"]);
});

test("flattenVisible skips collapsed subtrees", () => {
  const root = buildTree([row("A/B/C"), row("A/D"), row("E")], "/", true);
  expect(flattenVisible(root, new Set()).map((v) => v.node.path)).toEqual([
    "A",
    "E",
  ]);
  expect(flattenVisible(root, new Set(["A"])).map((v) => v.node.path)).toEqual([
    "A",
    "A/B",
    "A/D",
    "E",
  ]);
  expect(flattenVisible(root, new Set(["A"]))[1].depth).toBe(1);
});

test("pruneTree keeps matches, ancestors, score order", () => {
  const root = buildTree(
    [row("A/Match1"), row("A/Nope"), row("B/Match2")],
    "/",
    true,
  );
  const pruned = pruneTree(
    root,
    new Map([
      ["A/Match1", 0.5],
      ["B/Match2", 0.9],
    ]),
  );
  expect(pruned.children.map((c) => c.path)).toEqual(["B", "A"]); // B's best score wins
  expect(pruned.children[1].children.map((c) => c.path)).toEqual(["A/Match1"]);
});

test("ancestorPaths", () => {
  expect(ancestorPaths("A/B/C", "/")).toEqual(["A", "A/B"]);
  expect(ancestorPaths("Top", "/")).toEqual([]);
});

test("pruneTree keeps matches, ancestors, score order at depth", () => {
  // Regression for the memoized bestScore: a deeper tree where a grandchild's
  // score has to bubble up through two folder levels.
  const root = buildTree(
    [row("A/B/Match"), row("A/B/Nope"), row("A/Other"), row("C/Match2")],
    "/",
    true,
  );
  const pruned = pruneTree(
    root,
    new Map([
      ["A/B/Match", 0.3],
      ["C/Match2", 0.9],
    ]),
  );
  expect(pruned.children.map((c) => c.path)).toEqual(["C", "A"]);
  const a = pruned.children[1];
  expect(a.children.map((c) => c.path)).toEqual(["A/B"]);
  expect(a.children[0].children.map((c) => c.path)).toEqual(["A/B/Match"]);
});

test("allFolderPaths collects every folder, not leaves", () => {
  const root = buildTree([row("A/B/C"), row("A/D"), row("E")], "/", true);
  expect(allFolderPaths(root)).toEqual(new Set(["A", "A/B"]));
});

test("findNode finds nodes at any depth, and misses cleanly", () => {
  const root = buildTree([row("A/B/C"), row("D")], "/", true);
  expect(findNode(root, "A/B/C")!.segment).toBe("C");
  expect(findNode(root, "A/B")!.isFolder).toBe(true);
  expect(findNode(root, "")).toBe(root);
  expect(findNode(root, "A/B/Nope")).toBeUndefined();
  // A sibling whose name merely starts with another's -- the descent must
  // not mistake "AB" for a child of "A".
  const wide = buildTree([row("A/X"), row("AB")], "/", true);
  expect(findNode(wide, "AB")!.path).toBe("AB");
});

test("planMove computes the new name for a page and for the root", () => {
  const root = buildTree(
    [row("Journal/Today"), row("Projects/Alpha")],
    "/",
    true,
  );
  expect(planMove(root, "Journal/Today", "Projects", "/")).toEqual({
    kind: "move",
    obj: { name: "Journal/Today" },
    newName: "Projects/Today",
  });
  expect(planMove(root, "Journal/Today", "", "/")).toEqual({
    kind: "move",
    obj: { name: "Journal/Today" },
    newName: "Today",
  });
});

test("planMove moves a folder as a whole, flagged for the prefix rename", () => {
  const root = buildTree(
    [row("Projects/Alpha"), row("Archive/Keep")],
    "/",
    true,
  );
  // A pure folder has no row of its own, so the object is synthesized.
  expect(planMove(root, "Projects", "Archive", "/")).toEqual({
    kind: "move",
    obj: { name: "Projects", isFolder: true },
    newName: "Archive/Projects",
  });
  // A page that also has children keeps its own fields *and* gets the flag,
  // so `moveByRename` renames both the page and the subtree.
  const dual = buildTree(
    [
      {
        obj: { name: "Top/Projects", ref: "Top/Projects" },
        primary: "Projects",
      },
      row("Top/Projects/Alpha"),
    ],
    "/",
    true,
  );
  expect(planMove(dual, "Top/Projects", "", "/")).toEqual({
    kind: "move",
    obj: { name: "Top/Projects", ref: "Top/Projects", isFolder: true },
    newName: "Projects",
  });
});

test("planMove reports a collision instead of moving", () => {
  const root = buildTree([row("X/Alpha"), row("Projects/Alpha")], "/", true);
  expect(planMove(root, "X/Alpha", "Projects", "/")).toEqual({
    kind: "collision",
    newName: "Projects/Alpha",
  });
  // A folder counts too: merging two subtrees would overwrite whatever
  // names they share.
  const folders = buildTree(
    [row("X/Alpha/Deep"), row("Projects/Alpha")],
    "/",
    true,
  );
  expect(planMove(folders, "X/Alpha", "Projects", "/")).toEqual({
    kind: "collision",
    newName: "Projects/Alpha",
  });
});

test("planMove declines no-ops and self-descendant drops", () => {
  const root = buildTree([row("A/B/C"), row("D")], "/", true);
  expect(planMove(root, "A/B/C", "A/B", "/")).toEqual({ kind: "none" });
  expect(planMove(root, "A", "A", "/")).toEqual({ kind: "none" });
  expect(planMove(root, "A", "A/B", "/")).toEqual({ kind: "none" });
  expect(planMove(root, "D", "", "/")).toEqual({ kind: "none" });
  expect(planMove(root, "Gone", "A", "/")).toEqual({ kind: "none" });
});

test("planMove honors a multi-character separator", () => {
  const root = buildTree([row("A::B::C"), row("D")], "::", true);
  expect(planMove(root, "A::B::C", "D", "::")).toEqual({
    kind: "move",
    obj: { name: "A::B::C" },
    newName: "D::C",
  });
});

test("planMove never mutates the row's own object", () => {
  const projects = row("Projects");
  const root = buildTree([projects, row("Projects/Alpha")], "/", true);
  planMove(root, "Projects", "Archive", "/");
  expect(projects.obj).toEqual({ name: "Projects" });
});

test("computeTreeDisplay without scores uses the given expanded set", () => {
  const rows = [row("A/B"), row("C")];
  const display = computeTreeDisplay(rows, "/", true, {
    expanded: new Set(["A"]),
    expandAll: false,
  });
  expect(display.effectiveExpanded).toEqual(new Set(["A"]));
  expect(display.visible.map((v) => v.node.path)).toEqual(["A", "A/B", "C"]);
});

test("computeTreeDisplay with scores prunes and force-expands all folders", () => {
  const rows = [row("A/Match"), row("A/Nope"), row("B/Other")];
  const display = computeTreeDisplay(
    rows,
    "/",
    true,
    { expanded: new Set(), expandAll: false },
    new Map([["A/Match", 1]]),
  );
  expect(display.tree.children.map((c) => c.path)).toEqual(["A"]);
  expect(display.effectiveExpanded).toEqual(new Set(["A"]));
  expect(display.visible.map((v) => v.node.path)).toEqual(["A", "A/Match"]);
});

test("expandAll: every folder is open, at every depth", () => {
  const rows = [row("A/B/C"), row("A/D"), row("E")];
  const display = computeTreeDisplay(rows, "/", true, {
    expanded: new Set(),
    expandAll: true,
  });
  expect(display.effectiveExpanded).toEqual(new Set(["A", "A/B"]));
  expect(display.visible.map((v) => v.node.path)).toEqual([
    "A",
    "A/B",
    "A/B/C",
    "A/D",
    "E",
  ]);
});

test("expandAll: the set names the collapsed folders", () => {
  const rows = [row("A/B/C"), row("A/D"), row("E/F")];
  const display = computeTreeDisplay(rows, "/", true, {
    expanded: new Set(["A/B"]),
    expandAll: true,
  });
  expect(display.effectiveExpanded).toEqual(new Set(["A", "E"]));
  expect(display.visible.map((v) => v.node.path)).toEqual([
    "A",
    "A/B",
    "A/D",
    "E",
    "E/F",
  ]);
});

test("expandAll: a folder collapsed above hides the ones below it", () => {
  const rows = [row("A/B/C"), row("A/B/D")];
  const display = computeTreeDisplay(rows, "/", true, {
    expanded: new Set(["A"]),
    expandAll: true,
  });
  expect(display.visible.map((v) => v.node.path)).toEqual(["A"]);
});

test("expandAll: a folder that wasn't there before arrives expanded", () => {
  const collapsed = new Set(["A"]);
  const before = computeTreeDisplay([row("A/B"), row("C/D")], "/", true, {
    expanded: collapsed,
    expandAll: true,
  });
  expect(before.visible.map((v) => v.node.path)).toEqual(["A", "C", "C/D"]);
  // A refresh brings a new folder; the collapse the user made survives, and
  // the newcomer is open without anyone having said so.
  const after = computeTreeDisplay(
    [row("A/B"), row("C/D"), row("E/F/G")],
    "/",
    true,
    { expanded: collapsed, expandAll: true },
  );
  expect(after.visible.map((v) => v.node.path)).toEqual([
    "A",
    "C",
    "C/D",
    "E",
    "E/F",
    "E/F/G",
  ]);
});

test("expandAll: filtering force-expands, ignoring the collapsed set", () => {
  const rows = [row("A/Match"), row("A/Nope"), row("B/Other")];
  const display = computeTreeDisplay(
    rows,
    "/",
    true,
    { expanded: new Set(["A"]), expandAll: true },
    new Map([["A/Match", 1]]),
  );
  expect(display.effectiveExpanded).toEqual(new Set(["A"]));
  expect(display.visible.map((v) => v.node.path)).toEqual(["A", "A/Match"]);
});

test("withExpanded expands under either reading", () => {
  expect(withExpanded(new Set(["A"]), ["B"], false)).toEqual(
    new Set(["A", "B"]),
  );
  expect(withExpanded(new Set(["A", "B"]), ["B"], true)).toEqual(
    new Set(["A"]),
  );
  // Already open under expandAll: nothing to remove.
  expect(withExpanded(new Set(["A"]), ["B"], true)).toEqual(new Set(["A"]));
});

test("allNodes walks the whole tree, root excluded", () => {
  const root = buildTree([row("A/B/C"), row("D")], "/", true);
  expect(allNodes(root).map((n) => n.path)).toEqual(["A", "A/B", "A/B/C", "D"]);
});

test("nodeObject marks folders and never mutates the row's object", () => {
  const notes = row("Notes");
  const root = buildTree([notes, row("Notes/Sub"), row("Plain")], "/", true);
  // A page that is also a folder carries both its own fields and the hint.
  expect(nodeObject(findNode(root, "Notes")!)).toEqual({
    name: "Notes",
    isFolder: true,
  });
  expect(notes.obj).toEqual({ name: "Notes" });
  expect(nodeObject(findNode(root, "Plain")!)).toEqual({ name: "Plain" });
});

test("nodeObject synthesizes an object for a folder with no row of its own", () => {
  const root = buildTree([row("Projects/Alpha")], "/", true);
  expect(nodeObject(findNode(root, "Projects")!)).toEqual({
    name: "Projects",
    isFolder: true,
  });
});

test("priority floats siblings up, ties keep source order", () => {
  const root = buildTree(
    [row("Archive"), prioRow("Projects", 10), row("Zebra"), row("Areas")],
    "/",
    false,
  );
  expect(root.children.map((c) => c.path)).toEqual([
    "Projects",
    "Archive",
    "Zebra",
    "Areas",
  ]);
});

test("negative priority sinks below undecorated siblings", () => {
  const root = buildTree(
    [prioRow("Archive", -1), row("Projects"), row("Zebra")],
    "/",
    false,
  );
  expect(root.children.map((c) => c.path)).toEqual([
    "Projects",
    "Zebra",
    "Archive",
  ]);
});

test("priority sorts every level, not just the root", () => {
  const root = buildTree(
    [row("A/One"), prioRow("A/Two", 5), row("B")],
    "/",
    false,
  );
  expect(root.children.map((c) => c.path)).toEqual(["A", "B"]);
  expect(root.children[0].children.map((c) => c.segment)).toEqual([
    "Two",
    "One",
  ]);
});

test("a nested priority leaves its ancestor folder in place", () => {
  const root = buildTree(
    [row("Archive/Old"), prioRow("Zebra/Pinned", 10)],
    "/",
    false,
  );
  expect(root.children.map((c) => c.path)).toEqual(["Archive", "Zebra"]);
});

test("a dual's own priority pins its folder", () => {
  const root = buildTree(
    [row("Archive"), prioRow("Zebra", 10), row("Zebra/Child")],
    "/",
    false,
  );
  expect(root.children.map((c) => c.path)).toEqual(["Zebra", "Archive"]);
});

test("foldersFirst outranks priority", () => {
  const root = buildTree([prioRow("Page", 10), row("Folder/Child")], "/", true);
  expect(root.children.map((c) => c.path)).toEqual(["Folder", "Page"]);
});

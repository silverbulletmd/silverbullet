import { h } from "preact";
import { render } from "preact-render-to-string";
import { expect, test } from "vitest";
import { buildTree } from "./tree_model.ts";
import {
  activateTreeRow,
  externalFilesDrag,
  targetFolderForPath,
  TreeView,
  windowIncluding,
  windowShowing,
} from "./tree_view.tsx";

test("external file drags target folders, file parents, and root without catching internal moves", () => {
  const folders = new Set(["Notes", "Notes/Sub"]);
  expect(targetFolderForPath("Notes/Sub", folders, "/")).toBe("Notes/Sub");
  expect(targetFolderForPath("Notes/Page", folders, "/")).toBe("Notes");
  expect(targetFolderForPath("Root", folders, "/")).toBe("");
  expect(externalFilesDrag(["Files"], true)).toBe(true);
  expect(externalFilesDrag(["Files", "application/x-sb-nav-path"], true)).toBe(
    false,
  );
  expect(externalFilesDrag(["text/plain"], true)).toBe(false);
  expect(externalFilesDrag(["Files"], false)).toBe(false);
});

test("current page remains independent of target and retains tree hooks", () => {
  const tree = buildTree(
    [
      { primary: "Home", obj: { name: "Home" } },
      { primary: "Guide", obj: { name: "Notes/Guide" } },
    ],
    "/",
    true,
  );
  const html = render(
    h(TreeView, {
      tree,
      expanded: new Set(["Notes"]),
      selectedPath: "Notes/Guide",
      currentPath: "Home",
      showEmpty: true,
      separator: "/",
      canDrag: false,
      hasIcon: false,
      readOnly: false,
      onToggle() {},
      onSelect() {},
      onMove() {},
      onAction() {},
    }),
  );
  expect(html).toMatch(/data-path="Home"[^>]*aria-current="page"/);
  expect(html).toMatch(
    /class="sb-nav-row sb-nav-selected"[^>]*data-path="Notes\/Guide"/,
  );
  expect(html).not.toMatch(/data-path="Notes\/Guide"[^>]*aria-current/);
  expect(html).toContain('class="sb-treeitem"');
});

test("passive folders expand on row activation while passive leaves do nothing", () => {
  const actions: string[] = [];
  const folder = { path: "Notes", isFolder: true };
  const leaf = { path: "Notes/First", isFolder: false };
  activateTreeRow(folder, undefined, (path) => actions.push(`toggle:${path}`));
  activateTreeRow(leaf, undefined, (path) => actions.push(`toggle:${path}`));
  activateTreeRow(
    folder,
    (node) => actions.push(`select:${node.path}`),
    (path) => actions.push(`toggle:${path}`),
  );
  expect(actions).toEqual(["toggle:Notes", "select:Notes"]);
});

test("document actions render on every expanded row and can be disabled", () => {
  const tree = buildTree(
    [{ primary: "Guide", obj: { name: "Notes/Guide" } }],
    "/",
    true,
  );
  const html = render(
    h(TreeView, {
      tree,
      expanded: new Set(["Notes"]),
      showEmpty: true,
      separator: "/",
      canDrag: false,
      actions: [{ label: "Open", hasWhen: false }],
      documentActions: true,
      actionsDisabled: true,
      hasIcon: false,
      readOnly: false,
      onToggle() {},
      onMove() {},
      onAction() {},
    }),
  );
  expect(html.match(/aria-label="Open"/g)).toHaveLength(2);
  expect(html.match(/tabindex="0"/g)).toHaveLength(2);
  expect(html.match(/ disabled/g)).toHaveLength(2);
});

test("panel actions are only mounted for selected or hovered rows", () => {
  const tree = buildTree(
    [{ primary: "Guide", obj: { name: "Notes/Guide" } }],
    "/",
    true,
  );
  const html = render(
    h(TreeView, {
      tree,
      expanded: new Set(["Notes"]),
      selectedPath: "Notes/Guide",
      showEmpty: true,
      separator: "/",
      canDrag: false,
      actions: [{ label: "Open", hasWhen: false }],
      hasIcon: false,
      readOnly: false,
      onToggle() {},
      onMove() {},
      onAction() {},
    }),
  );
  expect(html.match(/aria-label="Open"/g)).toHaveLength(1);
  expect(html).toContain('tabindex="-1"');
});

test("read-only Space file rows remain draggable without making folder-only rows exportable", () => {
  const tree = buildTree(
    [{ primary: "Guide", obj: { name: "Notes/Guide", tag: "page" } }],
    "/",
    true,
  );
  const html = render(
    h(TreeView, {
      tree,
      expanded: new Set(["Notes"]),
      showEmpty: true,
      separator: "/",
      canDrag: false,
      fileDragData: (node) =>
        node.row
          ? { mime: "application/x-test", payload: node.path, downloadURL: "x" }
          : null,
      hasIcon: false,
      readOnly: true,
      onToggle() {},
      onMove() {},
      onAction() {},
    }),
  );
  expect(html).toMatch(/data-path="Notes"[^>]*draggable="false"/);
  expect(html).toMatch(/data-path="Notes\/Guide"[^>]*draggable="true"/);
});

test("long sibling lists render a first chunk, extended to reach the selected row", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => {
    const name = `Page ${String(i).padStart(4, "0")}`;
    return { primary: name, obj: { name } };
  });
  const tree = buildTree(rows, "/", true);
  const props = {
    tree,
    expanded: new Set<string>(),
    showEmpty: true,
    separator: "/",
    canDrag: false,
    hasIcon: false,
    readOnly: false,
    onToggle() {},
    onSelect() {},
    onMove() {},
    onAction() {},
  };
  const original = globalThis.IntersectionObserver;
  (globalThis as any).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  try {
    const rowCount = (html: string) =>
      (html.match(/role="treeitem"/g) ?? []).length;
    const first = render(h(TreeView, props));
    expect(rowCount(first)).toBe(200);
    expect(first).toContain('class="sb-tree-more"');
    const reaching = render(
      h(TreeView, { ...props, selectedPath: "Page 0600" }),
    );
    expect(rowCount(reaching)).toBe(200);
    expect(reaching).toContain('data-path="Page 0600"');
    expect(reaching).not.toContain('data-path="Page 0000"');
  } finally {
    (globalThis as any).IntersectionObserver = original;
  }
});

test("the rendered window extends to nearby rows and re-centres on distant ones", () => {
  expect(windowIncluding([0, 200], [], 1000)).toEqual([0, 200]);
  expect(windowIncluding([0, 200], [250], 1000)).toEqual([0, 251]);
  expect(windowIncluding([0, 200], [600], 1000)).toEqual([500, 700]);
  expect(windowIncluding([500, 700], [20], 1000)).toEqual([0, 200]);
  expect(windowIncluding([0, 200], [990], 1000)).toEqual([800, 1000]);
  expect(windowIncluding([0, 200], [5], 150)).toEqual([0, 150]);
});

test("scrolling extends the window nearby, moves it on a jump, and caps its size", () => {
  expect(windowShowing([0, 200], [200, 230], 25000)).toEqual([0, 330]);
  expect(windowShowing([0, 200], [12000, 12030], 25000)).toEqual([
    11900, 12130,
  ]);
  const [start, end] = windowShowing([0, 1000], [1100, 1130], 25000);
  expect(end - start).toBeLessThanOrEqual(1000);
  expect(start).toBeLessThanOrEqual(1000);
  expect(end).toBeGreaterThanOrEqual(1130);
  expect(windowShowing([24000, 24200], [24300, 24330], 25000)).toEqual([
    24000, 24430,
  ]);
  expect(windowShowing([24000, 24200], [24990, 25000], 25000)).toEqual([
    24890, 25000,
  ]);
});

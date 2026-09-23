import { h } from "preact";
import { render } from "preact-render-to-string";
import { expect, test } from "vitest";
import { buildTree } from "./tree_model.ts";
import {
  activateTreeRow,
  externalFilesDrag,
  targetFolderForPath,
  TreeView,
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

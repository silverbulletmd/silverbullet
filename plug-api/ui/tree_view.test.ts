import { h } from "preact";
import { render } from "preact-render-to-string";
import { expect, test } from "vitest";
import { buildTree } from "./tree_model.ts";
import { activateTreeRow, TreeView } from "./tree_view.tsx";

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

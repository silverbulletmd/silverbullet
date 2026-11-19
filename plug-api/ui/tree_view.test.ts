// @vitest-environment happy-dom
import { h, render as mount } from "preact";
import { render } from "preact-render-to-string";
import { expect, test } from "vitest";
import { buildTree } from "./tree_model.ts";
import {
  activateTreeRow,
  dropZone,
  externalFilesDrag,
  TreeView,
  targetFolderForPath,
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
    /<div(?=[^>]*class="sb-nav-row sb-nav-selected")[^>]*data-path="Notes\/Guide"/,
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

test("document actions render on every expanded row, each as one tabbable menu", () => {
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
  expect(html.match(/sb-row-menu-trigger/g)).toHaveLength(2);
  expect(html.match(/tabindex="0"/g)).toHaveLength(2);
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
  expect(html.match(/sb-row-menu-trigger/g)).toHaveLength(1);
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
        node.row ? { mime: "application/x-test", payload: node.path } : null,
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

test("the rendered window extends to nearby rows and re-centers on distant ones", () => {
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

test("a drop's zone: folder edges reorder, its middle moves in; pages split in half", () => {
  expect(dropZone(2, 20, true)).toBe("before");
  expect(dropZone(10, 20, true)).toBe("into");
  expect(dropZone(18, 20, true)).toBe("after");
  expect(dropZone(9, 20, false)).toBe("before");
  expect(dropZone(11, 20, false)).toBe("after");
});

/** Mounts a tree of `Other`, `Notes/A`, `Notes/B`, `Notes/Sub/C` (expanded)
 * and drives HTML5 drag events at its rows, each row 20px tall. */
function dragHarness(
  onReorder?: (...args: string[]) => void,
  expanded = ["Notes", "Notes/Sub"],
  extraProps: Record<string, unknown> = {},
) {
  // happy-dom lacks these, which makes preact bind `DragOver` and the like
  // instead of the lowercase event names.
  for (const name of [
    "dragstart",
    "dragover",
    "dragleave",
    "drop",
    "dragend",
  ]) {
    if (!(`on${name}` in HTMLElement.prototype)) {
      Object.defineProperty(HTMLElement.prototype, `on${name}`, {
        value: null,
        writable: true,
        configurable: true,
      });
    }
  }
  const calls: string[] = [];
  const tree = buildTree(
    ["Other", "Notes/A", "Notes/B", "Notes/Sub/C"].map((name) => ({
      primary: name,
      obj: { name },
    })),
    "/",
    false,
  );
  const root = document.createElement("div");
  document.body.appendChild(root);
  mount(
    h(TreeView, {
      tree,
      expanded: new Set(expanded),
      showEmpty: true,
      separator: "/",
      canDrag: true,
      hasIcon: false,
      readOnly: false,
      onToggle() {},
      onMove: (from: string, to: string) => calls.push(`move:${from}->${to}`),
      onReorder: onReorder
        ? (from: string, anchor: string, position: string) => {
            calls.push(`reorder:${from}:${position}:${anchor}`);
            onReorder(from, anchor, position);
          }
        : undefined,
      onAction() {},
      ...extraProps,
    }),
    root,
  );
  const row = (path: string) => {
    const el = root.querySelector(`[data-path="${path}"]`) as HTMLElement;
    el.getBoundingClientRect = () =>
      ({ top: 100, height: 20, bottom: 120 }) as DOMRect;
    return el;
  };
  const data = new Map<string, string>();
  const transfer = {
    get types() {
      return [...data.keys()];
    },
    setData: (k: string, v: string) => data.set(k, v),
    getData: (k: string) => data.get(k) ?? "",
    dropEffect: "none",
    effectAllowed: "all",
  };
  const fire = (el: HTMLElement, type: string, offsetY = 0) => {
    const e = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(e, { dataTransfer: transfer, clientY: 100 + offsetY });
    el.dispatchEvent(e);
    return e;
  };
  const drag = async (from: string, to: string, offsetY: number) => {
    const start = fire(row(from), "dragstart");
    const over = fire(row(to), "dragover", offsetY);
    await new Promise((r) => setTimeout(r, 0));
    const classes = row(to).className;
    fire(row(to), "drop", offsetY);
    fire(row(from), "dragend");
    return {
      accepted: over.defaultPrevented,
      classes,
      startPrevented: start.defaultPrevented,
    };
  };
  return { calls, data, drag, cleanup: () => root.remove() };
}

test("a row carrying file-drag data stays an in-app drag: it reorders and is never handed off as a download", async () => {
  const { calls, data, drag, cleanup } = dragHarness(() => {}, undefined, {
    fileDragData: (node: { path: string; row?: unknown }) =>
      node.row ? { mime: "application/x-test", payload: node.path } : null,
  });
  try {
    const result = await drag("Notes/B", "Notes/A", 1);
    expect(result.startPrevented).toBe(false);
    expect(data.has("DownloadURL")).toBe(false);
    expect(data.get("application/x-test")).toBe("Notes/B");
    expect(calls).toEqual(["reorder:Notes/B:before:Notes/A"]);
  } finally {
    cleanup();
  }
});

test("without onReorder an edge drop still moves into the parent folder", async () => {
  const { calls, drag, cleanup } = dragHarness();
  try {
    const { accepted, classes } = await drag("Other", "Notes/A", 1);
    expect(accepted).toBe(true);
    expect(classes).not.toMatch(/sb-nav-drop-(before|after)/);
    expect(calls).toEqual(["move:Other->Notes"]);
  } finally {
    cleanup();
  }
});

test("with onReorder a row's edges reorder and a folder's middle still moves in", async () => {
  const { calls, drag, cleanup } = dragHarness(() => {});
  try {
    const top = await drag("Notes/B", "Notes/A", 1);
    expect(top.accepted).toBe(true);
    expect(top.classes).toContain("sb-nav-drop-before");
    const bottom = await drag("Other", "Notes/B", 19);
    expect(bottom.classes).toContain("sb-nav-drop-after");
    const middle = await drag("Other", "Notes/Sub", 10);
    expect(middle.classes).toContain("sb-nav-droptarget");
    expect(middle.classes).not.toMatch(/sb-nav-drop-(before|after)/);
    expect(calls).toEqual([
      "reorder:Notes/B:before:Notes/A",
      "reorder:Other:after:Notes/B",
      "move:Other->Notes/Sub",
    ]);
  } finally {
    cleanup();
  }
});

test("a row can't be reordered against itself or a row inside it", async () => {
  const { calls, drag, cleanup } = dragHarness(() => {});
  try {
    expect((await drag("Notes/A", "Notes/A", 1)).accepted).toBe(false);
    expect((await drag("Notes", "Notes/Sub/C", 1)).accepted).toBe(false);
    expect(calls).toEqual([]);
  } finally {
    cleanup();
  }
});

test("an expanded folder's bottom edge inserts before its first child", async () => {
  const { calls, drag, cleanup } = dragHarness(() => {});
  try {
    expect((await drag("Other", "Notes", 19)).accepted).toBe(true);
    // The folder itself can't go inside its own subtree.
    expect((await drag("Notes", "Notes", 19)).accepted).toBe(false);
    expect(calls).toEqual(["reorder:Other:before:Notes/A"]);
  } finally {
    cleanup();
  }
});

test("a collapsed folder's bottom edge still inserts after it", async () => {
  const { calls, drag, cleanup } = dragHarness(() => {}, []);
  try {
    const { classes } = await drag("Other", "Notes", 19);
    expect(classes).toContain("sb-nav-drop-after");
    expect(calls).toEqual(["reorder:Other:after:Notes"]);
  } finally {
    cleanup();
  }
});

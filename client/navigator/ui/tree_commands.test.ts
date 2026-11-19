import { expect, test, vi } from "vitest";
import { buildTree } from "../../../plug-api/ui/tree_model.ts";
import type { NavigatorEngine } from "./engine.ts";
import type { DerivedView } from "./hooks/use_derived.ts";
import type { ActiveView, PanelSetters, SharedRefs } from "./panel.ts";

const writes: { key: string[]; paths: string[] }[] = [];
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  datastore: {
    set: (key: string[], paths: string[]) => {
      writes.push({ key, paths });
    },
  },
  editor: {
    flashNotification: (message: string) => {
      flashes.push(message);
    },
  },
}));
const flashes: string[] = [];

const { createTreeCommands } = await import("./tree_commands.ts");

function setup(
  defaultExpanded: boolean,
  filtering = false,
  initialExpanded = ["Projects"],
  engine = {} as NavigatorEngine,
) {
  flashes.length = 0;
  writes.length = 0;
  let expanded = new Set(initialExpanded);
  let dirty = false;
  const tree = buildTree(
    [
      { obj: { name: "Projects/Plan" }, primary: "Projects/Plan" },
      {
        obj: { name: "Projects/Archive/Old" },
        primary: "Projects/Archive/Old",
      },
      { obj: { name: "Journal/Today" }, primary: "Journal/Today" },
    ],
    "/",
    false,
  );
  const cmd = createTreeCommands({
    view: {
      name: "std.spaceTree",
      meta: {
        expandAll: defaultExpanded,
        expansionScope: "view",
        hierarchy: { separator: "/" },
      },
    } as ActiveView,
    engine,
    derived: {
      treeFiltering: filtering,
      treeDisplay: { tree, visible: [], effectiveExpanded: new Set() },
    } as unknown as DerivedView,
    refs: {
      input: { current: null },
      expandedDirty: {
        get current() {
          return dirty;
        },
        set current(value: boolean) {
          dirty = value;
        },
      },
    } as SharedRefs,
    set: {
      setExpanded: (update: (prev: Set<string>) => Set<string>) => {
        expanded = update(expanded);
      },
    } as PanelSetters,
    refresh: () => {},
  });
  return { cmd, expanded: () => [...expanded].sort(), dirty: () => dirty };
}

test("expand all opens nested folders and collapse all closes them", () => {
  const { cmd, expanded, dirty } = setup(false);

  cmd.expandAllFolders();
  expect(expanded()).toEqual(["Journal", "Projects", "Projects/Archive"]);
  expect(writes.at(-1)).toEqual({
    key: ["navigator", "std.spaceTree", "expanded"],
    paths: ["Projects", "Projects/Archive", "Journal"],
  });
  expect(dirty()).toBe(true);

  cmd.collapseAllFolders();
  expect(expanded()).toEqual([]);
  expect(writes.at(-1)?.paths).toEqual([]);
});

test("bulk actions respect views expanded by default", () => {
  const { cmd, expanded } = setup(true);

  cmd.collapseAllFolders();
  expect(expanded()).toEqual(["Journal", "Projects", "Projects/Archive"]);
  expect(writes.at(-1)?.key).toEqual([
    "navigator",
    "std.spaceTree",
    "collapsed",
  ]);

  cmd.expandAllFolders();
  expect(expanded()).toEqual([]);
  expect(writes.at(-1)?.paths).toEqual([]);
});

test("bulk expansion leaves filtered trees unchanged", () => {
  const { cmd, expanded, dirty } = setup(false, true);

  cmd.expandAllFolders();
  cmd.collapseAllFolders();

  expect(expanded()).toEqual(["Projects"]);
  expect(writes).toEqual([]);
  expect(dirty()).toBe(false);
});

test("bulk actions preserve folders outside the current segment", () => {
  const { cmd, expanded } = setup(false, false, ["Projects", "Elsewhere"]);

  cmd.expandAllFolders();
  expect(expanded()).toEqual([
    "Elsewhere",
    "Journal",
    "Projects",
    "Projects/Archive",
  ]);

  cmd.collapseAllFolders();
  expect(expanded()).toEqual(["Elsewhere"]);
});

function recordingEngine(fail?: "move" | "reorder") {
  const calls: unknown[][] = [];
  const engine = {
    move: async (view: string, obj: { name: string }, newName: string) => {
      calls.push(["move", view, obj.name, newName]);
      if (fail === "move") throw new Error("nope");
    },
    reorder: async (view: string, req: unknown) => {
      calls.push(["reorder", view, req]);
      if (fail === "reorder") throw new Error("nope");
    },
  } as unknown as NavigatorEngine;
  return { calls, engine };
}

test("reordering among siblings only writes the order", async () => {
  const { calls, engine } = recordingEngine();
  const { cmd } = setup(false, false, ["Projects"], engine);
  await cmd.reorderNode("Projects/Archive", "Projects/Plan", "before");
  expect(calls).toEqual([
    [
      "reorder",
      "std.spaceTree",
      {
        folder: "Projects",
        name: "Archive",
        anchor: "Plan",
        position: "before",
      },
    ],
  ]);
});

test("reordering next to a row in another folder moves there first", async () => {
  const { calls, engine } = recordingEngine();
  const { cmd } = setup(false, false, ["Projects"], engine);
  await cmd.reorderNode("Journal/Today", "Projects/Plan", "after");
  expect(calls).toEqual([
    ["move", "std.spaceTree", "Journal/Today", "Projects/Today"],
    [
      "reorder",
      "std.spaceTree",
      { folder: "Projects", name: "Today", anchor: "Plan", position: "after" },
    ],
  ]);
});

test("a failed or no-op move skips the reorder", async () => {
  const failing = recordingEngine("move");
  await setup(false, false, [], failing.engine).cmd.reorderNode(
    "Journal/Today",
    "Projects/Plan",
    "after",
  );
  expect(failing.calls.map((c) => c[0])).toEqual(["move"]);
  expect(flashes).toEqual(["Move failed: nope"]);

  // A move that plans to nothing (into its own subtree) reorders nothing.
  const none = recordingEngine();
  await setup(false, false, [], none.engine).cmd.reorderNode(
    "Projects",
    "Projects/Archive/Old",
    "before",
  );
  expect(none.calls).toEqual([]);
});

test("a failed reorder says so", async () => {
  const { engine } = recordingEngine("reorder");
  const { cmd } = setup(false, false, [], engine);
  await cmd.reorderNode("Projects/Archive", "Projects/Plan", "before");
  expect(flashes).toEqual(["Reorder failed: nope"]);
});

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
  editor: {},
}));

const { createTreeCommands } = await import("./tree_commands.ts");

function setup(
  defaultExpanded: boolean,
  filtering = false,
  initialExpanded = ["Projects"],
) {
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
    engine: {} as NavigatorEngine,
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

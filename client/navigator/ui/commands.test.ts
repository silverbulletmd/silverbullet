import { describe, expect, it, vi } from "vitest";

const navigated: string[] = [];
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  datastore: {},
  editor: {
    navigate: (ref: string) => {
      navigated.push(ref);
      return Promise.resolve();
    },
  },
}));

const { createCommands } = await import("./commands.ts");
import type { NavigatorEngine } from "./engine.ts";
import type { DerivedView } from "./hooks/use_derived.ts";
import type { ActiveView, PanelSetters, SharedRefs } from "./panel.ts";
import type { TreeNode } from "../../../plug-api/ui/tree_model.ts";

function treeNode(path: string, page: boolean): TreeNode {
  return {
    path,
    segment: path.split("/").pop()!,
    children: [],
    isFolder: true,
    row: page ? ({ obj: { name: path } } as any) : undefined,
  };
}

function setup(selectableFolders = false) {
  navigated.length = 0;
  const selected: Record<string, any>[] = [];
  let expanded = new Set<string>();
  const cmd = createCommands({
    slot: "lhs",
    // `expansionScope: "page"` keeps a toggle out of the datastore, which has
    // no host here.
    view: {
      name: "tree",
      meta: {
        expansionScope: "page",
        hierarchy: { separator: "/" },
        selectableFolders,
      },
    } as unknown as ActiveView,
    engine: {
      select: (_view: string, obj: Record<string, any>) => {
        selected.push(obj);
        return Promise.resolve(undefined);
      },
    } as unknown as NavigatorEngine,
    mobile: false,
    phrase: "",
    segmentIndex: 0,
    derived: {
      treeFiltering: false,
      treeDisplay: { effectiveExpanded: new Set<string>() },
    } as unknown as DerivedView,
    refs: {
      input: { current: null },
      returnTo: { current: undefined },
      segmentDirty: { current: false },
      expandedDirty: { current: false },
      displayed: { current: undefined },
      handledToken: { current: undefined },
    } as unknown as SharedRefs,
    set: {
      setExpanded: (update: any) => {
        expanded = update(expanded);
      },
    } as unknown as PanelSetters,
    refresh: () => {},
  });
  return { cmd, selected, expanded: () => expanded, navigated };
}

describe("selecting a tree node", () => {
  it("expands a plain folder", async () => {
    const { cmd, selected, expanded } = setup();
    await cmd.selectTreeNode(treeNode("Projects", false));
    expect([...expanded()]).toEqual(["Projects"]);
    expect(selected).toEqual([]);
  });

  it("opens a folder that is also a page", async () => {
    const { cmd, selected, expanded } = setup();
    await cmd.selectTreeNode(treeNode("Projects", true));
    expect(selected).toEqual([{ name: "Projects" }]);
    expect([...expanded()]).toEqual([]);
  });
});

// A tree whose folders may name something openable -- the space tree. Folders
// in the revisions and TOC trees are groupings, and keep the behaviour above.
describe("selecting a tree node when folders are selectable", () => {
  it("a folder with no page of its own only expands", async () => {
    const { cmd, selected, expanded, navigated } = setup(true);
    await cmd.selectTreeNode(treeNode("Projects", false));
    expect([...expanded()]).toEqual(["Projects"]);
    // Nothing here opens or creates a page that does not exist.
    expect(navigated).toEqual([]);
    expect(selected).toEqual([]);
  });

  it("a folder that is also a page opens it and expands too", async () => {
    const { cmd, selected, expanded } = setup(true);
    await cmd.selectTreeNode(treeNode("Projects", true));
    expect(selected).toEqual([{ name: "Projects" }]);
    expect([...expanded()]).toEqual(["Projects"]);
  });

  it("a dual expands rather than toggles, so a second click keeps it open", async () => {
    const { cmd, expanded } = setup(true);
    await cmd.selectTreeNode(treeNode("Projects", true));
    await cmd.selectTreeNode(treeNode("Projects", true));
    expect([...expanded()]).toEqual(["Projects"]);
  });

  it("a leaf is unaffected", async () => {
    const { cmd, selected, navigated } = setup(true);
    const leaf = { ...treeNode("Projects/Notes", true), isFolder: false };
    await cmd.selectTreeNode(leaf);
    expect(selected).toEqual([{ name: "Projects/Notes" }]);
    expect(navigated).toEqual([]);
  });
});

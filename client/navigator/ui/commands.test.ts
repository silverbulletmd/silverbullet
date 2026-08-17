import { describe, expect, it } from "vitest";
import { createCommands } from "./commands.ts";
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

function setup() {
  const selected: Record<string, any>[] = [];
  let expanded = new Set<string>();
  const cmd = createCommands({
    slot: "lhs",
    // `expansionScope: "page"` keeps a toggle out of the datastore, which has
    // no host here.
    view: {
      name: "tree",
      meta: { expansionScope: "page", hierarchy: { separator: "/" } },
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
  return { cmd, selected, expanded: () => expanded };
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

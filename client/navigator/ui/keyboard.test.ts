import { describe, expect, it } from "vitest";
import type { TreeNode } from "../../../plug-api/ui/tree_model.ts";
import type { Commands } from "./commands.ts";
import type { DerivedView } from "./hooks/use_derived.ts";
import { handleKeyDown, type KeyContext } from "./keyboard.ts";
import type { ActiveView } from "./panel.ts";

/** What the dispatch did, in the order it did it. */
type Trace = string[];

function makeCmd(trace: Trace, selectable: boolean): Commands {
  const record =
    (name: string, result?: any) =>
    (...args: any[]) => {
      const shown = args.map((arg) => arg?.path ?? arg).join(",");
      trace.push(args.length ? `${name}(${shown})` : name);
      return result;
    };
  return {
    close: record("close"),
    runCreate: record("runCreate"),
    selectedObj: record(
      "selectedObj",
      selectable ? { name: "Row" } : undefined,
    ),
    pickSegment: record("pickSegment"),
    routeToView: record("routeToView"),
    completeFolder: record("completeFolder"),
    completeNextSegment: record("completeNextSegment"),
    undoPrefix: record("undoPrefix", false),
    runKeymap: record("runKeymap"),
    runAction: record("runAction"),
    selectRow: record("selectRow"),
    toggleExpanded: record("toggleExpanded"),
    moveNode: record("moveNode"),
    selectTreeNode: record("selectTreeNode"),
    onTreeRowClick: record("onTreeRowClick"),
  } as unknown as Commands;
}

function makeCtx(
  trace: Trace,
  {
    keys,
    segments,
    pathCompletion,
    noFilter,
    phrase = "",
    interaction = "typing",
    /** Whether there is an object under the selection for a keymap to act on. */
    selectable = true,
  }: {
    keys?: string[];
    segments?: { label: string }[];
    pathCompletion?: boolean;
    noFilter?: boolean;
    phrase?: string;
    interaction?: "typing" | "navigating";
    selectable?: boolean;
  } = {},
): KeyContext {
  const view = {
    name: "test",
    meta: { keys, pathCompletion: !!pathCompletion, noFilter: !!noFilter },
  } as unknown as ActiveView;
  return {
    view,
    phrase,
    segmentIndex: 0,
    interaction: { current: interaction },
    derived: {
      segments,
      canCreate: false,
      isTreeMode: false,
      activeIndex: 0,
      lastIndex: 3,
    } as unknown as DerivedView,
    cmd: makeCmd(trace, selectable),
    set: {
      setPhrase: (v: any) => trace.push(`setPhrase(${v})`),
      setSelectedIndex: (v: any) => trace.push(`setSelectedIndex(${v})`),
      setSelectedPath: (v: any) => trace.push(`setSelectedPath(${v})`),
    },
  };
}

function press(init: Partial<KeyboardEvent> & { key: string }) {
  let defaultPrevented = false;
  const e = {
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    isComposing: false,
    code: "",
    preventDefault: () => {
      defaultPrevented = true;
    },
    ...init,
  } as unknown as KeyboardEvent;
  return { e, prevented: () => defaultPrevented };
}

describe("keyboard dispatch order", () => {
  it("gives a view's own key precedence over segment cycling", () => {
    const trace: Trace = [];
    const ctx = makeCtx(trace, {
      keys: ["Tab"],
      segments: [{ label: "a" }, { label: "b" }],
      interaction: "navigating",
    });
    const { e, prevented } = press({ key: "Tab" });
    handleKeyDown(e, ctx);
    expect(trace).toEqual(["selectedObj", "runKeymap(Tab,[object Object])"]);
    expect(prevented()).toBe(true);
  });

  it("claims Tab for the panel even with nothing to cycle", () => {
    const trace: Trace = [];
    const { e, prevented } = press({ key: "Tab" });
    handleKeyDown(e, makeCtx(trace));
    expect(trace).toEqual([]);
    expect(prevented()).toBe(true);
  });

  it("cycles segments on Tab, and backwards on Shift-Tab", () => {
    const trace: Trace = [];
    const ctx = makeCtx(trace, { segments: [{ label: "a" }, { label: "b" }] });
    handleKeyDown(press({ key: "Tab" }).e, ctx);
    handleKeyDown(press({ key: "Tab", shiftKey: true }).e, ctx);
    expect(trace).toEqual(["pickSegment(1)", "pickSegment(1)"]);
  });

  it("completes a segment on Alt-Space in either mode, leaving the mode alone", () => {
    const trace: Trace = [];
    const ctx = makeCtx(trace, { pathCompletion: true });
    handleKeyDown(press({ key: " ", code: "Space", altKey: true }).e, ctx);
    expect(trace).toEqual(["completeNextSegment"]);
    // A chord is never text, so `updateInteraction` has nothing to say about
    // it in either order -- which is why the stage-3-before-4 hinge is pinned
    // by the case below rather than by this one.
    expect(ctx.interaction.current).toBe("typing");
    handleKeyDown(press({ key: "ArrowDown" }).e, ctx);
    expect(ctx.interaction.current).toBe("navigating");
    handleKeyDown(press({ key: " ", code: "Space", altKey: true }).e, ctx);
    expect(ctx.interaction.current).toBe("navigating");
  });

  it("decides the interaction mode after path completion, never before", () => {
    // A `pathCompletion` view that claims `" "`, navigating, with nothing
    // under the selection: the keymap declines (no object), and the Space has
    // to stay declined. Run `updateInteraction` first and this key reads as
    // typing, which makes the plain-Space branch true and overwrites the
    // user's empty phrase with the current folder.
    const trace: Trace = [];
    const ctx = makeCtx(trace, {
      pathCompletion: true,
      keys: [" "],
      interaction: "navigating",
      selectable: false,
    });
    const { e, prevented } = press({ key: " ", code: "Space" });
    handleKeyDown(e, ctx);
    expect(trace).toEqual(["selectedObj"]);
    expect(prevented()).toBe(false);
    // Stage 4 still ran -- on the key stage 3 declined to consume.
    expect(ctx.interaction.current).toBe("typing");
  });

  it("yields Space to a view that claims it, but only while navigating", () => {
    const trace: Trace = [];
    const typing = makeCtx(trace, { pathCompletion: true, keys: [" "] });
    handleKeyDown(press({ key: " ", code: "Space" }).e, typing);
    expect(trace).toEqual(["completeFolder"]);

    const navigating = makeCtx(trace, {
      pathCompletion: true,
      keys: [" "],
      interaction: "navigating",
    });
    trace.length = 0;
    handleKeyDown(press({ key: " ", code: "Space" }).e, navigating);
    expect(trace).toEqual(["selectedObj", "runKeymap( ,[object Object])"]);
  });

  it("falls through to the default keys last", () => {
    const trace: Trace = [];
    const ctx = makeCtx(trace);
    handleKeyDown(press({ key: "Enter" }).e, ctx);
    handleKeyDown(press({ key: "ArrowDown" }).e, ctx);
    handleKeyDown(press({ key: "n", ctrlKey: true }).e, ctx);
    expect(trace).toEqual([
      "selectRow(0)",
      "setSelectedIndex(1)",
      "setSelectedIndex(1)",
    ]);
  });

  it("swallows printable keys in a filterless view, leaving navigation alone", () => {
    const trace: Trace = [];
    const ctx = makeCtx(trace, { noFilter: true });
    const { e, prevented } = press({ key: "a" });
    handleKeyDown(e, ctx);
    expect(trace).toEqual([]);
    expect(prevented()).toBe(true);

    // Navigation and selection still work...
    handleKeyDown(press({ key: "ArrowDown" }).e, ctx);
    handleKeyDown(press({ key: "Enter" }).e, ctx);
    expect(trace).toEqual(["setSelectedIndex(1)", "selectRow(0)"]);

    // ...and a modifier chord is not text, so it still bubbles out.
    trace.length = 0;
    const chord = press({ key: "k", metaKey: true });
    handleKeyDown(chord.e, ctx);
    expect(trace).toEqual([]);
    expect(chord.prevented()).toBe(false);
  });

  it("ignores a keystroke that is still composing", () => {
    const trace: Trace = [];
    handleKeyDown(press({ key: "Enter", isComposing: true }).e, makeCtx(trace));
    expect(trace).toEqual([]);
  });
});

function treeNode(
  path: string,
  { folder = false, page = false }: { folder?: boolean; page?: boolean } = {},
): TreeNode {
  return {
    path,
    segment: path.split("/").pop()!,
    children: [],
    isFolder: folder,
    row: page ? ({ obj: { name: path } } as any) : undefined,
  };
}

function makeTreeCtx(
  trace: Trace,
  {
    nodes,
    selected,
    expanded = [],
    treeFiltering = false,
    createSelectedInTree = false,
  }: {
    nodes: TreeNode[];
    selected: string;
    expanded?: string[];
    treeFiltering?: boolean;
    createSelectedInTree?: boolean;
  },
): KeyContext {
  const ctx = makeCtx(trace);
  const index = nodes.findIndex((node) => node.path === selected);
  return {
    ...ctx,
    view: {
      name: "tree",
      meta: { hierarchy: { separator: "/" } },
    } as unknown as ActiveView,
    derived: {
      ...ctx.derived,
      isTreeMode: true,
      treeVisible: nodes.map((node) => ({ node, depth: 0 })),
      treeLastIndex: nodes.length - 1,
      activeTreeIndex: index,
      activeTreeNode: nodes[index],
      treeDisplay: { effectiveExpanded: new Set(expanded) },
      treeFiltering,
      createSelectedInTree,
    } as unknown as DerivedView,
  };
}

describe("tree keys", () => {
  const nodes = [
    treeNode("Journal", { folder: true }),
    treeNode("Journal/Today", { page: true }),
    treeNode("Projects", { folder: true, page: true }),
    treeNode("Projects/Sub", { folder: true }),
  ];

  it("collapses an expanded folder on ArrowLeft", () => {
    const trace: Trace = [];
    const ctx = makeTreeCtx(trace, {
      nodes,
      selected: "Journal",
      expanded: ["Journal"],
    });
    const { e, prevented } = press({ key: "ArrowLeft" });
    handleKeyDown(e, ctx);
    expect(trace).toEqual(["toggleExpanded(Journal)"]);
    expect(prevented()).toBe(true);
  });

  it("steps out to the parent on ArrowLeft from a child row", () => {
    const trace: Trace = [];
    handleKeyDown(
      press({ key: "ArrowLeft" }).e,
      makeTreeCtx(trace, {
        nodes,
        selected: "Journal/Today",
        expanded: ["Journal"],
      }),
    );
    expect(trace).toEqual(["setSelectedPath(Journal)"]);
  });

  it("steps out to the parent on ArrowLeft from a collapsed folder", () => {
    const trace: Trace = [];
    handleKeyDown(
      press({ key: "ArrowLeft" }).e,
      makeTreeCtx(trace, {
        nodes,
        selected: "Projects/Sub",
        expanded: ["Projects"],
      }),
    );
    expect(trace).toEqual(["setSelectedPath(Projects)"]);
  });

  it("steps out rather than collapsing while the tree is filtered", () => {
    const trace: Trace = [];
    handleKeyDown(
      press({ key: "ArrowLeft" }).e,
      makeTreeCtx(trace, {
        nodes,
        selected: "Projects/Sub",
        expanded: ["Projects", "Projects/Sub"],
        treeFiltering: true,
      }),
    );
    expect(trace).toEqual(["setSelectedPath(Projects)"]);
  });

  it("leaves a collapsed root folder alone on ArrowLeft", () => {
    const trace: Trace = [];
    const { e, prevented } = press({ key: "ArrowLeft" });
    handleKeyDown(e, makeTreeCtx(trace, { nodes, selected: "Journal" }));
    expect(trace).toEqual([]);
    expect(prevented()).toBe(true);
  });

  it("hands the selected node to selectTreeNode on Enter, folder or page", () => {
    const trace: Trace = [];
    handleKeyDown(
      press({ key: "Enter" }).e,
      makeTreeCtx(trace, { nodes, selected: "Journal" }),
    );
    handleKeyDown(
      press({ key: "Enter" }).e,
      makeTreeCtx(trace, { nodes, selected: "Projects" }),
    );
    handleKeyDown(
      press({ key: "Enter" }).e,
      makeTreeCtx(trace, {
        nodes,
        selected: "Journal",
        createSelectedInTree: true,
      }),
    );
    expect(trace).toEqual([
      "selectTreeNode(Journal)",
      "selectTreeNode(Projects)",
      "runCreate",
    ]);
  });
});

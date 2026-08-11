import { describe, expect, it } from "vitest";
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
      trace.push(args.length ? `${name}(${args.join(",")})` : name);
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
    phrase = "",
    interaction = "typing",
    /** Whether there is an object under the selection for a keymap to act on. */
    selectable = true,
  }: {
    keys?: string[];
    segments?: { label: string }[];
    pathCompletion?: boolean;
    phrase?: string;
    interaction?: "typing" | "navigating";
    selectable?: boolean;
  } = {},
): KeyContext {
  const view = {
    name: "test",
    meta: { keys, pathCompletion: !!pathCompletion },
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

  it("ignores a keystroke that is still composing", () => {
    const trace: Trace = [];
    handleKeyDown(press({ key: "Enter", isComposing: true }).e, makeCtx(trace));
    expect(trace).toEqual([]);
  });
});

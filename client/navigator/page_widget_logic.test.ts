import { beforeEach, expect, test, vi } from "vitest";
import type { Row } from "./types.ts";

/**
 * The page widget's own logic, minus its rendering: this project's vitest run
 * has no jsdom (see `nav_error_boundary.test.ts`), so a hook-driven function
 * component can't be mounted here. Everything the widget decides -- when to
 * re-fetch, how much to draw, when the slot is settled enough to measure, what
 * a keystroke does -- lives in `page_widget_logic.ts` instead, and is asserted
 * directly.
 */
import {
  activateOnKey,
  contentOutcome,
  createLoadGate,
  createSettleTracker,
  isRowActivation,
  loadIdentity,
  needsMarkdown,
  rowsIdentity,
  settlesSlot,
  shouldCommit,
  showsBody,
  subscribeRefresh,
  toggleCollapsed,
  treeKeyAction,
  visibleRows,
  widgetKind,
} from "./page_widget_logic.ts";

function fakeHook() {
  const listeners = new Map<string, ((...args: any[]) => any)[]>();
  return {
    listeners,
    hook: {
      addLocalListener: vi.fn((name: string, cb: (...a: any[]) => any) => {
        listeners.set(name, [...(listeners.get(name) ?? []), cb]);
      }),
      removeLocalListener: vi.fn((name: string, cb: (...a: any[]) => any) => {
        listeners.set(
          name,
          (listeners.get(name) ?? []).filter((c) => c !== cb),
        );
      }),
    },
    emit(name: string) {
      for (const cb of listeners.get(name) ?? []) cb();
    },
    live() {
      return [...listeners].filter(([, cbs]) => cbs.length > 0).map(([n]) => n);
    },
  };
}

function row(primary: string): Row {
  return { obj: { name: primary }, primary };
}

beforeEach(() => {
  vi.useFakeTimers();
});

test("refresh runs debounced on every event the view declares", () => {
  const hook = fakeHook();
  const run = vi.fn();
  subscribeRefresh(
    hook.hook,
    ["mq:emptyQueue:indexQueue", "editor:pageLoaded"],
    run,
  );

  hook.emit("mq:emptyQueue:indexQueue");
  expect(run).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300);
  expect(run).toHaveBeenCalledTimes(1);

  hook.emit("editor:pageLoaded");
  vi.advanceTimersByTime(300);
  expect(run).toHaveBeenCalledTimes(2);
});

test("a burst of events collapses into one refresh", () => {
  const hook = fakeHook();
  const run = vi.fn();
  subscribeRefresh(hook.hook, ["editor:pageModified"], run);

  hook.emit("editor:pageModified");
  vi.advanceTimersByTime(200);
  hook.emit("editor:pageModified");
  vi.advanceTimersByTime(200);
  hook.emit("editor:pageModified");
  expect(run).not.toHaveBeenCalled();

  vi.advanceTimersByTime(300);
  expect(run).toHaveBeenCalledTimes(1);
});

test("teardown removes every listener and cancels a pending refresh", () => {
  const hook = fakeHook();
  const run = vi.fn();
  const unsubscribe = subscribeRefresh(
    hook.hook,
    ["editor:pageLoaded", "editor:pageModified"],
    run,
  );
  expect(hook.live()).toEqual(["editor:pageLoaded", "editor:pageModified"]);

  hook.emit("editor:pageLoaded");
  unsubscribe();

  vi.advanceTimersByTime(1000);
  expect(run).not.toHaveBeenCalled();
  expect(hook.live()).toEqual([]);
});

test("a duplicated event name subscribes (and fires) once", () => {
  const hook = fakeHook();
  const run = vi.fn();
  subscribeRefresh(hook.hook, ["editor:pageLoaded", "editor:pageLoaded"], run);
  expect(hook.hook.addLocalListener).toHaveBeenCalledTimes(1);

  hook.emit("editor:pageLoaded");
  vi.advanceTimersByTime(300);
  expect(run).toHaveBeenCalledTimes(1);
});

test("a view declaring no refresh events subscribes to nothing", () => {
  const hook = fakeHook();
  const unsubscribe = subscribeRefresh(hook.hook, [], vi.fn());
  expect(hook.hook.addLocalListener).not.toHaveBeenCalled();
  unsubscribe();
  expect(hook.hook.removeLocalListener).not.toHaveBeenCalled();
});

test("rows over the view's limit are capped, with the remainder counted", () => {
  const rows = [row("a"), row("b"), row("c"), row("d")];
  expect(visibleRows(rows, 2)).toEqual({ shown: [rows[0], rows[1]], more: 2 });
});

test("rows at or under the limit render whole, with nothing left over", () => {
  const rows = [row("a"), row("b")];
  expect(visibleRows(rows, 2)).toEqual({ shown: rows, more: 0 });
  expect(visibleRows(rows, 5)).toEqual({ shown: rows, more: 0 });
  expect(visibleRows([], 5)).toEqual({ shown: [], more: 0 });
});

test("a missing or zero limit caps nothing", () => {
  const rows = [row("a"), row("b")];
  expect(visibleRows(rows, 0)).toEqual({ shown: rows, more: 0 });
  expect(visibleRows(rows, undefined as any)).toEqual({ shown: rows, more: 0 });
});

test("Enter and Space activate a row, and suppress the browser's own default", () => {
  for (const key of ["Enter", " "]) {
    const activate = vi.fn();
    const preventDefault = vi.fn();
    activateOnKey({ key, preventDefault }, activate);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  }
});

test("any other key leaves the row alone", () => {
  for (const key of ["a", "Tab", "ArrowDown", "Escape"]) {
    const activate = vi.fn();
    const preventDefault = vi.fn();
    activateOnKey({ key, preventDefault }, activate);
    expect(activate).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  }
});

test("the slot settles only once every view has reported", () => {
  const settled = vi.fn();
  const report = createSettleTracker(["a", "b", "c"], settled);

  report("a");
  report("b");
  expect(settled).not.toHaveBeenCalled();

  report("c");
  expect(settled).toHaveBeenCalledTimes(1);
});

test("an empty slot settles immediately, so its height caches as zero", () => {
  const settled = vi.fn();
  createSettleTracker([], settled);
  expect(settled).toHaveBeenCalledTimes(1);
});

test("a view reporting twice can't settle the slot for a view still fetching", () => {
  const settled = vi.fn();
  const report = createSettleTracker(["a", "b"], settled);

  report("a");
  report("a");
  expect(settled).not.toHaveBeenCalled();

  report("b");
  expect(settled).toHaveBeenCalledTimes(1);
});

test("a re-fetch after the slot settled re-measures", () => {
  const settled = vi.fn();
  const report = createSettleTracker(["a", "b"], settled);
  report("a");
  report("b");
  expect(settled).toHaveBeenCalledTimes(1);

  // What a refreshOn-driven reload reports: the rows changed, so the height
  // the slot cached a moment ago may no longer be the right one.
  report("a");
  expect(settled).toHaveBeenCalledTimes(2);
});

test("plain row text skips the markdown pipeline entirely", () => {
  // The overwhelmingly common case: page names, ref labels, task pages.
  for (const plain of [
    "SomePage",
    "Projects/Alpha",
    "SomePage@1234",
    "my_page_name",
    "snake_case_ref",
    "A page with spaces",
    "",
  ]) {
    expect(needsMarkdown(plain)).toBe(false);
  }
});

test("row text carrying markdown is routed through the renderer", () => {
  for (const md of [
    "See [[SilverBullet]]",
    "run `npm test`",
    "* a bullet",
    "**bold**",
    "_em_",
    "~~struck~~",
    "[link](https://example.com)",
    "bare https://example.com",
    "<b>html</b>",
    "a & b",
  ]) {
    expect(needsMarkdown(md)).toBe(true);
  }
});

test("a click on a link inside a row belongs to the link, not the row", () => {
  const inside = (sel: string) => ({
    closest: (q: string) => (q.includes(sel) ? {} : null),
  });
  expect(isRowActivation(inside("a"))).toBe(false);
  expect(isRowActivation(inside("button"))).toBe(false);
  expect(isRowActivation(inside("input"))).toBe(false);
});

test("a click on plain row text activates the row", () => {
  expect(isRowActivation({ closest: () => null })).toBe(true);
  // A target with no `closest` at all (never in a browser, but the handler
  // must not throw its way out of a click).
  expect(isRowActivation(null)).toBe(true);
  expect(isRowActivation({})).toBe(true);
});

// --- Content views (`view.define { content = ... }`) -------------------------
// Same pattern as the helpers above: `PageContentWidget`'s decisions are
// exported so they can be asserted without mounting it.

const NODE = {} as HTMLElement;

test("a content widget shows nothing until its load has settled", () => {
  expect(contentOutcome(undefined)).toBe("pending");
});

test("rendered content is ready; nothing to show is empty, however it got there", () => {
  expect(contentOutcome({ markdown: "# Hi", node: NODE })).toBe("ready");
  // The view said nothing...
  expect(contentOutcome({ markdown: "" })).toBe("empty");
  expect(contentOutcome({ markdown: "   \n  " })).toBe("empty");
  // ...or it said something that rendered to nothing. Same thing to a reader:
  // no widget at all.
  expect(contentOutcome({ markdown: "# Hi", node: undefined })).toBe("empty");
});

test("an error is an outcome in its own right, load error or render error", () => {
  expect(contentOutcome({ markdown: "", error: "source blew up" })).toBe(
    "error",
  );
  // A *render* failure: the markdown arrived, turning it into HTML is what
  // failed. This is the case that used to never report a settle (I2).
  expect(contentOutcome({ markdown: "# Hi", error: "expand failed" })).toBe(
    "error",
  );
});

// The regression this pairs with: a render failure that never reported left
// `createSettleTracker` with a name still pending, so the slot's height cache
// kept reserving a phantom gap on every later visit to the page.
test("every terminal outcome reports the slot settle; only pending withholds it", () => {
  expect(settlesSlot("pending")).toBe(false);
  for (const outcome of ["error", "empty", "ready"] as const) {
    expect(settlesSlot(outcome)).toBe(true);
  }
});

test("a content view gets the markdown widget, everything else the row widget", () => {
  expect(widgetKind({ hasContent: true })).toBe("content");
  expect(widgetKind({ hasContent: false })).toBe("rows");
  // Absent (every built-in, and every row view defined before content views
  // existed) is a row view, not a broken one.
  expect(widgetKind({})).toBe("rows");
});

test("a collapse toggle flips and persists the same value", () => {
  // Both halves, always: a toggle that flipped without persisting would come
  // back expanded on the next page load with nothing to say why.
  expect(toggleCollapsed(false)).toEqual({ next: true, persist: true });
  expect(toggleCollapsed(true)).toEqual({ next: false, persist: false });
});

test("a collapsed widget draws no body, and neither does one with nothing to show", () => {
  expect(showsBody(false, true)).toBe(true);
  expect(showsBody(true, true)).toBe(false);
  // Nothing to draw is nothing to draw, collapsed or not.
  expect(showsBody(false, false)).toBe(false);
  expect(showsBody(true, false)).toBe(false);
});

// --- Page-dock tree keyboard ------------------------------------------------
// A page dock has no filter input to drive the tree from, so the rows take
// their own keys. These are the standard tree bindings, and the same pair the
// panel's own pipeline uses.

test("Enter and Space open a row, folder or not", () => {
  for (const key of ["Enter", " "]) {
    expect(treeKeyAction(key, { isFolder: true, isExpanded: false })).toBe(
      "select",
    );
    expect(treeKeyAction(key, { isFolder: false, isExpanded: false })).toBe(
      "select",
    );
  }
});

test("Right opens a closed folder, Left closes an open one", () => {
  expect(
    treeKeyAction("ArrowRight", { isFolder: true, isExpanded: false }),
  ).toBe("expand");
  expect(treeKeyAction("ArrowLeft", { isFolder: true, isExpanded: true })).toBe(
    "collapse",
  );
});

// The keystroke has nothing to do in these states, so it must fall through to
// the browser rather than being swallowed: a page dock sits in the middle of a
// document the arrows still have to move through.
test("Left/Right do nothing on a leaf, or in the direction already taken", () => {
  expect(
    treeKeyAction("ArrowRight", { isFolder: true, isExpanded: true }),
  ).toBeUndefined();
  expect(
    treeKeyAction("ArrowLeft", { isFolder: true, isExpanded: false }),
  ).toBeUndefined();
  for (const key of ["ArrowLeft", "ArrowRight"]) {
    expect(
      treeKeyAction(key, { isFolder: false, isExpanded: false }),
    ).toBeUndefined();
  }
});

test("every other key is left to the page", () => {
  for (const key of ["a", "Tab", "ArrowDown", "ArrowUp", "Escape"]) {
    expect(
      treeKeyAction(key, { isFolder: true, isExpanded: false }),
    ).toBeUndefined();
  }
});

// --- Skipping a no-op refresh ----------------------------------------------

test("identical rows produce an identical identity, and a changed field does not", () => {
  const a = [{ obj: { name: "A", pos: 1 }, primary: "A" }];
  const same = [{ obj: { name: "A", pos: 1 }, primary: "A" }];
  expect(rowsIdentity(a)).toBe(rowsIdentity(same));

  // The rendered text is unchanged, but `pos` moved -- which is exactly what
  // an edit above a heading does to `std.toc`. Comparing only drawn fields
  // would leave the row navigating to a stale offset.
  const moved = [{ obj: { name: "A", pos: 99 }, primary: "A" }];
  expect(rowsIdentity(a)).not.toBe(rowsIdentity(moved));

  const renamed = [{ obj: { name: "A", pos: 1 }, primary: "B" }];
  expect(rowsIdentity(a)).not.toBe(rowsIdentity(renamed));
});

// A Lua-built object can carry closures; those serialise away. Anything that
// defeats serialisation entirely has to read as "cannot say".
test("rowsIdentity ignores functions, and gives up on a cycle", () => {
  const withFn = [{ obj: { name: "A", run: () => {} }, primary: "A" }];
  const without = [{ obj: { name: "A" }, primary: "A" }];
  expect(rowsIdentity(withFn as any)).toBe(rowsIdentity(without));

  const cyclic: any = { name: "A" };
  cyclic.self = cyclic;
  expect(rowsIdentity([{ obj: cyclic, primary: "A" }])).toBeUndefined();
});

test("the first load always commits, whatever it produced", () => {
  expect(shouldCommit(undefined, loadIdentity(undefined, ""))).toBe(true);
  expect(shouldCommit(undefined, loadIdentity(undefined, "# hi"))).toBe(true);
  expect(shouldCommit(undefined, loadIdentity("boom", ""))).toBe(true);
});

test("an unchanged result does not commit; a changed one does", () => {
  const first = loadIdentity(undefined, "# hi");
  expect(shouldCommit(first, loadIdentity(undefined, "# hi"))).toBe(false);
  expect(shouldCommit(first, loadIdentity(undefined, "# there"))).toBe(true);
});

// Comparing like with like: the error is part of the identity, so neither side
// can be masked by content that happens to match across the transition.
test("error transitions always commit, in both directions", () => {
  const ok = loadIdentity(undefined, "");
  const bad = loadIdentity("boom", "");
  expect(shouldCommit(ok, bad)).toBe(true);
  expect(shouldCommit(bad, ok)).toBe(true);
  // ...and one error replaced by a different one.
  expect(shouldCommit(bad, loadIdentity("other", ""))).toBe(true);
  // The same error twice running is genuinely nothing new.
  expect(shouldCommit(bad, loadIdentity("boom", ""))).toBe(false);
});

test("an unserialisable result is treated as changed, never as unchanged", () => {
  const known = loadIdentity(undefined, "# hi");
  expect(shouldCommit(known, loadIdentity(undefined, undefined))).toBe(true);
});

// --- The commit gate -------------------------------------------------------
// The wiring, not just the comparison. Both Important bugs of round 4 lived
// here: what gets recorded, and when.

test("the gate skips a repeat of what it committed, and takes anything else", () => {
  const gate = createLoadGate();
  const hi = loadIdentity(undefined, "# hi");

  expect(gate.shouldCommit(hi)).toBe(true); // first load
  gate.committed(hi);
  expect(gate.shouldCommit(hi)).toBe(false); // unchanged
  expect(gate.shouldCommit(loadIdentity(undefined, "# there"))).toBe(true);
});

// The regression this exists for: the identity used to be recorded when the
// load *arrived*, before the render that could still throw. A failed render
// then left the success identity recorded, so the next identical refresh was
// skipped -- and the error stayed on screen until the user navigated away.
test("a failed render leaves nothing recorded, so an identical refresh retries", () => {
  const gate = createLoadGate();
  const same = loadIdentity(undefined, "# hi");

  expect(gate.shouldCommit(same)).toBe(true);
  gate.failed(); // the render threw; nothing reached the screen

  // Byte-identical markdown, and it must still be retried.
  expect(gate.shouldCommit(same)).toBe(true);
  gate.committed(same);
  expect(gate.shouldCommit(same)).toBe(false);
});

test("a committed error is remembered, and recovering from it commits", () => {
  const gate = createLoadGate();
  const bad = loadIdentity("boom", "");
  gate.committed(bad);

  // The same error again is genuinely nothing new...
  expect(gate.shouldCommit(bad)).toBe(false);
  // ...but a success that clears it must land, even though the markdown
  // either side of the transition is empty.
  expect(gate.shouldCommit(loadIdentity(undefined, ""))).toBe(true);
});

test("decorations are part of a row's identity", () => {
  // `TreeView` draws these as chips, so a decoration carrying a count or a
  // relative time would otherwise freeze at whatever it said on first load.
  const before = [
    { obj: { name: "A" }, primary: "A", decorations: [{ text: "2 min ago" }] },
  ];
  const after = [
    { obj: { name: "A" }, primary: "A", decorations: [{ text: "1 hr ago" }] },
  ];
  expect(rowsIdentity(before as any)).not.toBe(rowsIdentity(after as any));
});

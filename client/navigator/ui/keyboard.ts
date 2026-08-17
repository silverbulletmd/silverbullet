import type { MutableRef } from "preact/hooks";
import type { Commands } from "./commands.ts";
import { cycleSegmentIndex } from "./segments.ts";
import { CREATE_PATH, type DerivedView } from "./hooks/use_derived.ts";
import type { ActiveView, PanelSetters } from "./panel.ts";
import { ancestorPaths } from "../../../plug-api/ui/tree_model.ts";

// Keys that move the selection, i.e. that put the panel in navigating mode.
// (Tree mode adds ArrowLeft/ArrowRight; in list mode those move the caret.)
const NAV_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
]);

export type KeyContext = {
  view?: ActiveView;
  phrase: string;
  segmentIndex: number;
  /** Typing vs navigating -- see `updateInteraction`. */
  interaction: MutableRef<"typing" | "navigating">;
  derived: DerivedView;
  cmd: Commands;
  set: Pick<PanelSetters, "setPhrase" | "setSelectedIndex" | "setSelectedPath">;
};

/**
 * The panel's whole keydown pipeline, in the one order it may run in. Each
 * stage exists to run *ahead* of the next, and three rounds of findings
 * turned on exactly that:
 *
 * 1. `tryKeymap` -- a view's own keys come first, so nothing built in can
 *    shadow them. It yields back on its own for a printable key while the
 *    user is typing.
 * 2. `cycleSegment` -- Tab/Ctrl-Arrow are the panel's unconditionally; Tab in
 *    particular must never reach the browser's focus order.
 * 3. Path completion -- ahead of `updateInteraction`, which would otherwise
 *    read the `Alt-Space` chord as ordinary typing.
 * 4. `updateInteraction` -- decided by whichever key got this far, i.e. one
 *    no view claimed and no chord above consumed.
 * 5. The default keys -- prefix undo, create, then list or tree navigation.
 */
export function handleKeyDown(e: KeyboardEvent, ctx: KeyContext) {
  const { view, phrase, derived, cmd, set } = ctx;
  const { setPhrase, setSelectedIndex } = set;
  if (e.isComposing) return;
  if (tryKeymap(e, ctx)) return;
  if (cycleSegment(e, ctx)) return;
  // Ahead of `updateInteraction`, which would otherwise read the Alt chord
  // below as ordinary typing.
  if (view?.meta.pathCompletion && e.code === "Space") {
    // Alt-Space in either mode: it is a chord, so it is never text.
    if (e.altKey && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      cmd.completeNextSegment();
      return;
    }
    // Plain Space on an empty phrase, where it would otherwise insert a
    // leading space nobody wants. The interaction mode is not a property of
    // this gesture -- it is how it yields to a `keymap` that claims `" "`:
    // in such a view a Space while navigating is that view's action, and
    // only a Space while typing completes the folder. A view that claims
    // nothing has nothing to yield to, so it completes in either mode.
    if (
      !e.altKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      phrase === "" &&
      (ctx.interaction.current !== "navigating" ||
        !view.meta.keys?.includes(" "))
    ) {
      e.preventDefault();
      void cmd.completeFolder();
      return;
    }
  }
  updateInteraction(e, ctx);
  if (e.key === "Backspace" && phrase === "" && cmd.undoPrefix()) {
    e.preventDefault();
    return;
  }
  // Shift-Enter creates from anywhere in the list, matching FilterList.
  if (e.key === "Enter" && e.shiftKey && derived.canCreate) {
    e.preventDefault();
    void cmd.runCreate();
    return;
  }
  if (derived.isTreeMode) {
    treeKeyDown(e, ctx);
    return;
  }
  const { activeIndex, lastIndex } = derived;
  const setIndex = (n: number) =>
    setSelectedIndex(Math.max(0, Math.min(lastIndex, n)));

  if (e.key === "Enter") {
    e.preventDefault();
    void cmd.selectRow(activeIndex);
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    void cmd.close();
    return;
  }
  if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
    setIndex(activeIndex - 1);
  } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
    setIndex(activeIndex + 1);
  } else if (e.key === "PageUp") {
    setIndex(activeIndex - 5);
  } else if (e.key === "PageDown") {
    setIndex(activeIndex + 5);
  } else if (e.key === "Home") {
    setIndex(0);
  } else if (e.key === "End") {
    setIndex(lastIndex);
  } else {
    // Anything else -- a global chord (Cmd-/, say) included -- is left alone
    // to reach the client's own keydown handling by ordinary bubbling.
    return;
  }
  e.preventDefault();
}

/**
 * View-defined keys, ahead of built-in handling -- they can't collide with
 * it, `navigator.define` rejects the navigation keys at definition time.
 * Returns whether the key was consumed.
 */
function tryKeymap(e: KeyboardEvent, ctx: KeyContext): boolean {
  const { view, cmd, interaction } = ctx;
  if (!view?.meta.keys?.includes(e.key)) return false;
  // Modifier chords aren't expressible as claimed keys, and letting them
  // through here would shadow the Ctrl-p/Ctrl-n navigation aliases.
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  // A printable key is only an action while the user is navigating. In
  // typing mode it has to reach the input, or claiming " " would eat every
  // space in a multi-word filter phrase.
  if (e.key.length === 1 && interaction.current !== "navigating") {
    return false;
  }
  const obj = cmd.selectedObj();
  if (!obj) return false;
  e.preventDefault();
  void cmd.runKeymap(e.key, obj);
  return true;
}

/**
 * Ctrl-Arrow steps through the segments. A chord rather than a printable
 * key: those belong to the phrase (see `updateInteraction`), and a view's
 * own `keymap` can claim them. Shift is ignored so Ctrl-Shift-Arrow works
 * too -- on macOS, Mission Control may swallow the plain chord.
 */
function cycleSegment(e: KeyboardEvent, ctx: KeyContext): boolean {
  const { derived, cmd, segmentIndex } = ctx;
  const count = derived.segments?.length ?? 0;
  // Tab is the panel's, always. Focus lives in the filter input for the
  // whole life of the panel -- that is the entire keyboard contract -- so
  // letting Tab walk the browser's focus order would drop the user
  // somewhere they can't type, in a UI with nowhere else to go. With
  // segments it steps through them; without, it does nothing at all.
  if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    if (count < 2) return true;
    cmd.pickSegment(
      cycleSegmentIndex(segmentIndex, count, e.shiftKey ? -1 : 1),
    );
    return true;
  }
  if (count < 2 || !e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return false;
  e.preventDefault();
  cmd.pickSegment(
    cycleSegmentIndex(segmentIndex, count, e.key === "ArrowRight" ? 1 : -1),
  );
  return true;
}

/**
 * Typing vs navigating, which is what decides whether a printable claimed
 * key edits the phrase or runs its action. Only *explicit* input flips it:
 * a passive selection change (followEditor reveal, activation defaults)
 * must not silently turn the next keystroke into a command.
 */
function updateInteraction(e: KeyboardEvent, ctx: KeyContext) {
  const { interaction, derived } = ctx;
  if (
    NAV_KEYS.has(e.key) ||
    (e.ctrlKey && (e.key === "p" || e.key === "n")) ||
    (derived.isTreeMode && (e.key === "ArrowLeft" || e.key === "ArrowRight"))
  ) {
    interaction.current = "navigating";
  } else if (
    e.key === "Backspace" ||
    e.key === "Delete" ||
    (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey)
  ) {
    interaction.current = "typing";
  }
}

function treeKeyDown(e: KeyboardEvent, ctx: KeyContext) {
  const { view, phrase, derived, cmd, set } = ctx;
  const { setPhrase, setSelectedPath } = set;
  const {
    treeVisible,
    treeLastIndex,
    activeTreeIndex,
    activeTreeNode,
    treeDisplay,
    treeFiltering,
    createSelectedInTree,
  } = derived;
  if (!view) return;
  const setTreePath = (n: number) => {
    if (treeLastIndex < 0) return;
    const index = Math.max(0, Math.min(treeLastIndex, n));
    if (index >= treeVisible.length) {
      setSelectedPath(CREATE_PATH);
      return;
    }
    const node = treeVisible[index]?.node;
    if (node) setSelectedPath(node.path);
  };

  if (e.key === "Enter") {
    e.preventDefault();
    if (createSelectedInTree) void cmd.runCreate();
    else if (activeTreeNode) void cmd.selectTreeNode(activeTreeNode);
    return;
  }
  if (e.key === "Escape") {
    e.preventDefault();
    void cmd.close();
    return;
  }
  if (e.key === "ArrowUp" || (e.ctrlKey && e.key === "p")) {
    setTreePath(activeTreeIndex - 1);
  } else if (e.key === "ArrowDown" || (e.ctrlKey && e.key === "n")) {
    setTreePath(activeTreeIndex + 1);
  } else if (e.key === "PageUp") {
    setTreePath(activeTreeIndex - 5);
  } else if (e.key === "PageDown") {
    setTreePath(activeTreeIndex + 5);
  } else if (e.key === "Home") {
    setTreePath(0);
  } else if (e.key === "End") {
    setTreePath(treeLastIndex);
  } else if (e.key === "ArrowRight") {
    if (!activeTreeNode?.isFolder) return;
    if (!treeDisplay?.effectiveExpanded.has(activeTreeNode.path)) {
      cmd.toggleExpanded(activeTreeNode.path);
    } else {
      setTreePath(activeTreeIndex + 1);
    }
  } else if (e.key === "ArrowLeft") {
    if (!activeTreeNode) return;
    if (
      !treeFiltering &&
      activeTreeNode.isFolder &&
      treeDisplay?.effectiveExpanded.has(activeTreeNode.path)
    ) {
      cmd.toggleExpanded(activeTreeNode.path);
    } else {
      const ancestors = ancestorPaths(
        activeTreeNode.path,
        view.meta.hierarchy.separator,
      );
      const parentPath = ancestors[ancestors.length - 1];
      if (parentPath !== undefined) setSelectedPath(parentPath);
    }
  } else {
    return;
  }
  e.preventDefault();
}

import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { datastore } from "@silverbulletmd/silverbullet/syscalls";
import type { MutableRef } from "preact/hooks";
import { dispatch } from "./engine.ts";
import { defaultSegmentIndex } from "./segments.ts";
import type { DerivedView } from "./hooks/use_derived.ts";
import {
  type ActiveView,
  engine,
  navHooks,
  type PanelSetters,
  type SharedRefs,
} from "./panel.ts";
import {
  completeSegment,
  completionCandidate,
  folderPrefix,
} from "./phrase.ts";
import { nodeObject, type TreeNode } from "../../../plug-api/ui/tree_model.ts";
import { createTreeCommands } from "./tree_commands.ts";

export type CommandDeps = {
  slot: string;
  view?: ActiveView;
  /** Whether the host is below its mobile breakpoint -- see `closesOnSelect`. */
  mobile: boolean;
  phrase: string;
  segmentIndex: number;
  derived: DerivedView;
  refs: SharedRefs;
  set: PanelSetters;
  /** The view this slot's iframe currently believes is displayed -- see
   * `close`, which won't hide the panel for a view that's no longer it. */
  displayed: MutableRef<string | undefined>;
  /** That same view's activation token -- see `close`. */
  handledToken: MutableRef<number | undefined>;
};

export type Commands = ReturnType<typeof createCommands>;

/**
 * Everything the panel *does*: the bridge calls a selection, an action, a
 * keymap key or a drag turns into, plus the phrase/segment/expansion edits
 * that go with them. Rebuilt per render (like the handlers it replaced), so
 * every one of them closes over the render's own derived state.
 */
export function createCommands({
  slot,
  view,
  mobile,
  phrase,
  segmentIndex,
  derived,
  refs,
  set,
  displayed,
  handledToken,
}: CommandDeps) {
  const { input: inputRef, returnTo, segmentDirty } = refs;
  const { setPhrase, setSegmentIndex, setSelectedIndex, setSelectedPath } = set;
  const {
    segments,
    canCreate,
    createIndex,
    createSelected,
    activeIndex,
    rowAtIndex,
    trimmedPhrase,
    isTreeMode,
    treeVisible,
    visible,
    activeTreeNode,
  } = derived;
  const tree = createTreeCommands({ view, derived, refs, set });

  async function close() {
    // A cheap, early check: if a newer activation has already reached this
    // iframe (`displayed` updated), skip the round trip entirely rather than
    // asking the host to hide something that's already stale.
    if (view && displayed.current !== undefined && displayed.current !== view.name) {
      return;
    }
    // The authoritative check: `editor.hidePanel`'s own syscall message can
    // still arrive at the host *after* a newer activation's `show` does --
    // an iframe -> host round trip racing a worker -> host one for the same
    // key has no ordering guarantee -- even though `displayed` above hadn't
    // caught up yet when this call started. Handing over the token this
    // activation was given (see navigator.ts's `show`) lets the host compare
    // against an identity captured *before* that race, rather than
    // re-derived after it, which is what actually closes the gap the
    // `displayed` check above can't. See task-pick-api-review.md's
    // Critical 1.
    await syscall("editor.hidePanel", slot, handledToken.current);
    await syscall("editor.focus");
  }

  // A mobile drawer covers the editor whole, so it dismisses on a selection
  // exactly like the modal does -- leaving it up would hide what was just
  // opened. A desktop sidebar stays, that being the point of a sidebar.
  const closesOnSelect = slot === "modal" || mobile;

  async function runCreate() {
    if (!view || !canCreate) return;
    await engine.create(view.name, trimmedPhrase);
    if (closesOnSelect) {
      await close();
    } else {
      setPhrase("");
      setSelectedIndex(0);
    }
  }

  /**
   * The object under the selection, or undefined when there is nothing to act
   * on. A pure folder is nothing to act on -- it has no object of its own --
   * but a page that also heads one does, and it reaches the handler through
   * `nodeObject` (i.e. carrying `isFolder`), exactly as it reaches `actions`
   * and `onMove`.
   */
  function selectedObj(): Record<string, any> | undefined {
    if (createSelected) return undefined;
    if (isTreeMode) {
      return activeTreeNode?.row ? nodeObject(activeTreeNode) : undefined;
    }
    return rowAtIndex(activeIndex)?.row.obj;
  }

  function pickSegment(index: number) {
    const segment = segments?.[index];
    if (!view || !segment) return;
    setSegmentIndex(index);
    segmentDirty.current = true;
    // Zero persistence for a `navigator.pick`: the segment it opens on is
    // whichever the spec's `default` names, every time.
    if (!view.meta.ephemeral) {
      void datastore.set(["navigator", view.name, "segment"], segment.label);
    }
    // A different subset: whatever was selected says nothing about it.
    setSelectedIndex(0);
    setSelectedPath(undefined);
    // The panel's whole keyboard contract depends on the input holding focus;
    // a click on a segment must hand it straight back.
    inputRef.current?.focus();
  }

  /**
   * A `prefixViews` hop: the sibling view takes this slot, carrying whatever
   * followed the prefix. Routed through the plug rather than swapped in here,
   * so the slot's bookkeeping (which view a resize belongs to, which events
   * the host forwards, the activation token) stays in one place. The datasets
   * themselves are already cached in the engine, so the swap is a re-render.
   */
  function routeToView(target: string, carried: string, from?: string) {
    void dispatch("navigator:route", {
      slot,
      view: target,
      phrase: carried,
      from,
    }).catch((e) => console.error("navigator: route failed", e));
  }

  /**
   * `Space` on an empty phrase, in a `pathCompletion` view: the folder the
   * editor is currently in, so the next thing typed is scoped to it. Async
   * only because the current path is the host's to know.
   */
  async function completeFolder() {
    try {
      const path: string = await syscall("editor.getCurrentPath");
      setPhrase(folderPrefix(path));
      setSelectedIndex(0);
      setSelectedPath(undefined);
    } catch (e) {
      console.error("navigator: path completion failed", e);
    }
  }

  /**
   * `Alt-Space` in a `pathCompletion` view: extend the phrase by one path
   * segment of the best match, so a deep hierarchy is walked rather than typed.
   */
  function completeNextSegment() {
    const names = isTreeMode
      ? treeVisible.map((v) => v.node.path)
      : visible.map((v) => v.row.primary);
    const completed = completeSegment(
      phrase,
      completionCandidate(names, phrase),
    );
    if (completed === undefined || completed === phrase) return;
    setPhrase(completed);
    setSelectedIndex(0);
    setSelectedPath(undefined);
  }

  /**
   * Backspace on an empty phrase, undoing whichever prefix got us here: a
   * `prefixViews` hop steps back to the view that invoked it, and a prefix-
   * activated segment steps back to the view's default segment. Returns
   * whether it consumed the key.
   */
  function undoPrefix(): boolean {
    if (returnTo.current) {
      const back = returnTo.current;
      returnTo.current = undefined;
      routeToView(back, "");
      return true;
    }
    const fallback = defaultSegmentIndex(segments);
    if (segments?.[segmentIndex]?.prefix && segmentIndex !== fallback) {
      pickSegment(fallback);
      return true;
    }
    return false;
  }

  async function runKeymap(key: string, obj: Record<string, any>) {
    if (!view) return;
    await engine.key(view.name, key, obj);
    // The default contract is that the panel keeps focus: a handler that
    // navigates goes through `client.navigate`, which focuses the editor on
    // the way out. Take it back once the handler has settled -- an action
    // that wants the editor focused calls `editor.focus()` itself, after us.
    inputRef.current?.focus();
  }

  /**
   * `primary` is what a `confirm` message names the row by; the action itself
   * only ever sees the object.
   */
  async function runAction(
    index: number,
    obj: Record<string, any>,
    primary: string,
  ) {
    if (!view) return;
    await engine.action(view.name, index, obj, primary);
    // Same contract as `runKeymap`: the panel keeps focus (a confirm dialog,
    // or an action that navigates, will have taken it in the meantime).
    inputRef.current?.focus();
    // An action that renamed or deleted something leaves the view showing what
    // used to be there; the file events would refresh us eventually, but this
    // (debounced, like `moveNode`'s) makes it prompt.
    navHooks.refresh?.();
  }

  async function selectRow(index: number) {
    if (!view) return;
    if (index === createIndex) {
      await runCreate();
      return;
    }
    const entry = rowAtIndex(index);
    if (!entry) return;
    const kept = await engine.select(
      view.name,
      entry.row.obj,
      returnTo.current,
    );
    // An `onSelect` that returned false has taken the slot over itself (the
    // tag picker handing it back to the picker that routed to it, say), so
    // closing here would shut the panel it just opened.
    if (closesOnSelect && kept !== false) await close();
  }

  async function selectTreeNode(node: TreeNode) {
    if (!view) return;
    if (node.row) {
      const kept = await engine.select(
        view.name,
        node.row.obj,
        returnTo.current,
      );
      if (closesOnSelect && kept !== false) await close();
    } else {
      tree.toggleExpanded(node.path);
    }
  }

  function onTreeRowClick(node: TreeNode) {
    setSelectedPath(node.path);
    void selectTreeNode(node);
  }

  return {
    ...tree,
    close,
    runCreate,
    selectedObj,
    pickSegment,
    routeToView,
    completeFolder,
    completeNextSegment,
    undoPrefix,
    runKeymap,
    runAction,
    selectRow,
    selectTreeNode,
    onTreeRowClick,
  };
}

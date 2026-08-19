import { datastore, editor } from "@silverbulletmd/silverbullet/syscalls";
import { nodeObject, type TreeNode } from "../../../plug-api/ui/tree_model.ts";
import { hide, route } from "../navigator.ts";
import type { NavigatorEngine } from "./engine.ts";
import type { DerivedView } from "./hooks/use_derived.ts";
import type { ActiveView, PanelSetters, SharedRefs } from "./panel.ts";
import {
  completeSegment,
  completionCandidate,
  folderPrefix,
} from "./phrase.ts";
import { defaultSegmentIndex } from "./segments.ts";
import { createTreeCommands } from "./tree_commands.ts";

export type CommandDeps = {
  slot: string;
  view?: ActiveView;
  engine: NavigatorEngine;
  /** Whether the host is below its mobile breakpoint -- see `closesOnSelect`. */
  mobile: boolean;
  phrase: string;
  segmentIndex: number;
  derived: DerivedView;
  refs: SharedRefs;
  set: PanelSetters;
  /** The debounced source re-run -- see `runAction`. */
  refresh: () => void;
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
  engine,
  mobile,
  phrase,
  segmentIndex,
  derived,
  refs,
  set,
  refresh,
}: CommandDeps) {
  const {
    input: inputRef,
    returnTo,
    segmentDirty,
    dropdownDirty,
    displayed,
    handledToken,
  } = refs;
  const {
    setPhrase,
    setSegmentIndex,
    setDropdownValue,
    setSelectedIndex,
    setSelectedPath,
  } = set;
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
  const tree = createTreeCommands({
    view,
    engine,
    derived,
    refs,
    set,
    refresh,
  });

  async function close() {
    // A newer activation may already have taken this slot, in which case this
    // close belongs to nothing: the token it was handed is what the lifecycle
    // compares against the slot's current occupant before closing anything.
    if (
      view &&
      displayed.current !== undefined &&
      displayed.current !== view.name
    ) {
      return;
    }
    await hide(slot, handledToken.current);
    await editor.focus();
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

  /** The dropdown counterpart of `pickSegment`; index -1 is the built-in
   * "All". Persisted as the option's value, not its index, so a reordered
   * option set restores to the same choice. */
  function pickDropdown(index: number) {
    if (!view?.meta.dropdown) return;
    const value = index >= 0 ? view.dropdownOptions?.[index]?.value : undefined;
    setDropdownValue(value);
    dropdownDirty.current = true;
    if (!view.meta.ephemeral) {
      void datastore.set(["navigator", view.name, "dropdown"], value ?? null);
    }
    setSelectedIndex(0);
    setSelectedPath(undefined);
    inputRef.current?.focus();
  }

  /**
   * A `prefixViews` hop: the sibling view takes this slot, carrying whatever
   * followed the prefix. Routed through the lifecycle rather than swapped in
   * here, so the slot's bookkeeping (which view a resize belongs to, the
   * activation token) stays in one place. The datasets themselves are already
   * cached in the engine, so the swap is a re-render.
   */
  function routeToView(target: string, carried: string, from?: string) {
    void route({
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
      const path = await editor.getCurrentPath();
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

  async function runAction(index: number, obj: Record<string, any>) {
    if (!view) return;
    await engine.action(view.name, index, obj);
    // Same contract as `runKeymap`: the panel keeps focus (a confirm dialog,
    // or an action that navigates, will have taken it in the meantime).
    inputRef.current?.focus();
    // An action that renamed or deleted something leaves the view showing what
    // used to be there; the file events would refresh us eventually, but this
    // (debounced, like `moveNode`'s) makes it prompt.
    refresh();
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
    // Tree rows are drag sources, exempt from the panel-wide mousedown
    // suppression (see NavRoot), so the click blurred the input; take focus
    // back before the selection possibly hands it on to the editor.
    inputRef.current?.focus();
    setSelectedPath(node.path);
    void selectTreeNode(node);
  }

  return {
    ...tree,
    close,
    runCreate,
    selectedObj,
    pickSegment,
    pickDropdown,
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

import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { datastore } from "@silverbulletmd/silverbullet/syscalls";
import type { DerivedView } from "./hooks/use_derived.ts";
import {
  type ActiveView,
  engine,
  navHooks,
  type PanelSetters,
  type SharedRefs,
} from "./panel.ts";
import { planMove, withExpanded } from "../../../plug-api/ui/tree_model.ts";
import { expansionKey } from "./expansion.ts";

/**
 * What tree mode does to the tree itself: the expansion set (persisted per
 * view, so a dock comes back the way it was left) and drag-and-drop moves.
 * Split from the rest of the commands because these are the only ones that
 * write structure rather than act on a selection.
 */
export function createTreeCommands({
  view,
  derived,
  refs,
  set,
}: {
  view?: ActiveView;
  derived: DerivedView;
  refs: SharedRefs;
  set: PanelSetters;
}) {
  const { expandedDirty } = refs;
  const { setExpanded } = set;
  const { treeFiltering, treeDisplay } = derived;

  const expandAll = view?.meta.expandAll === true;

  function persistExpanded(next: Set<string>) {
    if (!view) return;
    // A page-scoped tree has nowhere to persist to: its paths are the current
    // page's, so a stored set would arrive on top of a different page's rows.
    const key = expansionKey(view.name, view.meta);
    if (key) void datastore.set(key, [...next]);
  }

  function toggleExpanded(path: string) {
    // Filtering force-expands every pruned folder; a manual toggle in that
    // state would just be overridden on the next render, so skip it (and the
    // datastore write) rather than have it silently do nothing visible.
    if (treeFiltering) return;
    expandedDirty.current = true;
    setExpanded((prev) => {
      // Membership means "open" under one reading and "closed" under the
      // other, so flipping it is the same gesture either way.
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      persistExpanded(next);
      return next;
    });
  }

  function expandPath(path: string) {
    expandedDirty.current = true;
    setExpanded((prev) => {
      const next = withExpanded(prev, [path], expandAll);
      // `withExpanded` only ever adds or only ever removes, so an unchanged
      // size means it was already open.
      if (next.size === prev.size) return prev;
      persistExpanded(next);
      return next;
    });
  }

  /** A completed drag: `targetFolder` is `""` for a drop on the root area. */
  async function moveNode(draggedPath: string, targetFolder: string) {
    if (!view || !treeDisplay) return;
    const plan = planMove(
      treeDisplay.tree,
      draggedPath,
      targetFolder,
      view.meta.hierarchy.separator,
    );
    if (plan.kind === "none") return;
    if (plan.kind === "collision") {
      await syscall(
        "editor.flashNotification",
        `${plan.newName} already exists`,
        "error",
      );
      return;
    }
    try {
      await engine.move(view.name, plan.obj, plan.newName);
    } catch (e: any) {
      await syscall(
        "editor.flashNotification",
        `Move failed: ${e?.message ?? e}`,
        "error",
      );
      return;
    }
    // Otherwise a drop on a collapsed folder just makes the row vanish.
    if (targetFolder) expandPath(targetFolder);
    // The rename's file events refresh us anyway; this only makes it prompt.
    navHooks.refresh?.();
  }

  return { toggleExpanded, moveNode };
}

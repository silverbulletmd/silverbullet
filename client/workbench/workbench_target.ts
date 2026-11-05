/**
 * Opening the Workbench on a tab, and on some tabs on a part of it. The
 * Workbench may be closed, so the target waits here until its tab takes it.
 */
import { useLayoutEffect, useRef } from "preact/hooks";
import { type OpenOptions, showView } from "../navigator/navigator.ts";
import {
  WORKBENCH_VIEW,
  type WorkbenchTab,
} from "../navigator/views/workbench.ts";
import type { CodeSection } from "./code/code_view.tsx";
import type { DataViewKind } from "./data/data_model.ts";
import type { LibrariesFocus } from "./libraries/libraries_model.ts";

export type WorkbenchTarget =
  | { tab: "Code"; section: CodeSection }
  | { tab: "Data"; view: DataViewKind }
  | { tab: "Libraries"; focus: LibrariesFocus }
  | { tab: Exclude<WorkbenchTab, "Code" | "Data" | "Libraries"> };

type TabTarget<T extends WorkbenchTarget["tab"]> = Extract<
  WorkbenchTarget,
  { tab: T }
>;

let pending: WorkbenchTarget | undefined;
const listeners = new Set<() => void>();

export async function openWorkbench(
  target: WorkbenchTarget,
  show: (view: string, opts: OpenOptions) => Promise<unknown> = showView,
): Promise<void> {
  pending = target;
  for (const listener of [...listeners]) listener();
  try {
    await show(WORKBENCH_VIEW, { segment: target.tab });
  } catch (e) {
    // Nothing will take it; don't let it run on some later show
    if (pending === target) pending = undefined;
    throw e;
  }
}

/** The pending target if it is for `tab`, once. */
export function takeWorkbenchTarget<T extends WorkbenchTarget["tab"]>(
  tab: T,
): TabTarget<T> | undefined {
  if (pending?.tab !== tab) return undefined;
  const target = pending as TabTarget<T>;
  pending = undefined;
  return target;
}

export function onWorkbenchTarget(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Hands `tab`'s targets to `take`: one waiting when the tab mounts, and later ones as they come. */
export function useWorkbenchTarget<T extends WorkbenchTarget["tab"]>(
  tab: T,
  take: (target: TabTarget<T>) => void,
): void {
  const latest = useRef(take);
  latest.current = take;
  // Before paint, so the tab never shows its previous part first
  useLayoutEffect(() => {
    const check = () => {
      const target = takeWorkbenchTarget(tab);
      if (target) latest.current(target);
    };
    check();
    return onWorkbenchTarget(check);
  }, [tab]);
}

import { allViewNames, resolveMeta } from "./registry.ts";
import { dockState } from "./navigator.ts";
import type { ViewMeta } from "./types.ts";

/** A page-docked view, with the persisted state its widget starts from. */
export type PageSlotView = {
  name: string;
  meta: ViewMeta;
  /** Rolled up to its title bar -- see `dock_state.ts`. */
  collapsed: boolean;
};

/** The views a page slot draws: resolved to this slot, and open. */
export async function pageSlotViews(
  slot: "page-top" | "page-bottom",
): Promise<PageSlotView[]> {
  const out: PageSlotView[] = [];
  for (const name of allViewNames()) {
    const meta = resolveMeta(name);
    if (!meta) continue;
    const docks = meta.supportedDocks ?? [meta.dock];
    // Cheap pre-filter: a view that can't page-dock at all never needs the
    // datastore reads below.
    if (!docks.includes("page-top") && !docks.includes("page-bottom")) continue;
    if ((await dockState.resolveDock(name, meta)) !== slot) continue;
    if (!(await dockState.isOpen(name, meta))) continue;
    out.push({ name, meta, collapsed: await dockState.isCollapsed(name) });
  }
  return out;
}

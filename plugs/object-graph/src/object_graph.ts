import { syscall } from "@silverbulletmd/silverbullet/syscall";
import { datastore } from "@silverbulletmd/silverbullet/syscalls";
import type {
  PanelViewContext,
  PanelViewResult,
} from "@silverbulletmd/silverbullet/type/manifest";
import {
  buildGlobalGraph,
  buildUniverse,
  expandObject as expandObjectImpl,
  invalidateGraphCache,
} from "./graph_builder.ts";
import { buildGraphHtml } from "./graph_html.ts";
import {
  defaultFilters,
  defaultForceSettings,
  type ExpansionResult,
  type Filters,
  type ForceSettings,
  type RootViewModel,
} from "./model.ts";

const FILTERS_KEY = ["object-graph", "filters"];
const FORCES_KEY = ["object-graph", "forces"];

async function loadFilters(): Promise<Filters> {
  const raw = (await datastore.get(FILTERS_KEY)) as
    | Partial<Filters>
    | undefined;
  if (!raw) return defaultFilters;
  return { ...defaultFilters, ...raw } as Filters;
}

async function loadForces(): Promise<ForceSettings> {
  const raw = (await datastore.get(FORCES_KEY)) as
    | Partial<ForceSettings>
    | undefined;
  if (!raw) return defaultForceSettings;
  return { ...defaultForceSettings, ...raw } as ForceSettings;
}

const GRAPH_VIEW = "std.graph";

export async function showGraph() {
  await syscall("view.open", GRAPH_VIEW, { segment: "Local" });
}

export async function showGlobalGraph() {
  await syscall("view.open", GRAPH_VIEW, { segment: "Global" });
}

/**
 * Builds the graph view's panel (declared on this function in the manifest):
 * around the open page, or every page in the space.
 */
export async function graphPanel(
  ctx: PanelViewContext,
): Promise<PanelViewResult> {
  // Each build gets fresh data. Subsequent `expandObject` round-trips from
  // the panel reuse the populated cache.
  invalidateGraphCache();
  const view =
    ctx.tab === "Global" ? await globalView(ctx) : await localView(ctx);
  return "error" in view ? view : buildGraphHtml(view);
}

async function localView({
  page,
  dock,
}: PanelViewContext): Promise<RootViewModel | { error: string }> {
  if (!page) return { error: "Open a page to see its graph." };
  const [root, universe, filters, forces] = await Promise.all([
    expandObjectImpl(page),
    buildUniverse(),
    loadFilters(),
    loadForces(),
  ]);
  return { root, universe, filters, forces, dock };
}

/**
 * Called from the panel via system.invokeFunction("object-graph.expandObject", ref).
 * Pure: takes a ref, returns an ExpansionResult, no side effects.
 */
export async function expandObject(ref: string): Promise<ExpansionResult> {
  return expandObjectImpl(ref);
}

/**
 * The global view: all pages + every relation in the space, pre-expanded.
 * Filter state defaults to "mention only" and is not persisted (so the local
 * view's saved filters aren't disturbed).
 */
async function globalView({
  page,
  dock,
}: PanelViewContext): Promise<RootViewModel | { error: string }> {
  const [root, universe] = await Promise.all([
    buildGlobalGraph(page || null),
    buildUniverse(),
  ]);
  if (!root) return { error: "There are no pages in this space yet." };
  // Default the global view to "mention only" — every other relation
  // label in the universe is hidden but can be toggled on without a
  // refetch (the full relation set is already loaded).
  const hiddenLabels = universe.labels.filter((l) => l !== "mention");
  return {
    root,
    universe,
    filters: {
      hiddenTags: [],
      hiddenLabels,
      hideEdgeLabels: true,
      hideOrphans: false,
    },
    forces: await loadForces(),
    initialAllExpanded: true,
    persistFilters: false,
    dock,
  };
}

import { datastore, editor } from "@silverbulletmd/silverbullet/syscalls";
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

export async function showGraph() {
  const currentPage = await editor.getCurrentPage();
  if (!currentPage) {
    await editor.flashNotification("Graph: no current page", "error");
    return;
  }
  // Each top-level open of the modal gets fresh data. Subsequent
  // `expandObject` round-trips from the panel reuse the populated cache.
  invalidateGraphCache();
  const [root, universe, filters, forces] = await Promise.all([
    expandObjectImpl(currentPage),
    buildUniverse(),
    loadFilters(),
    loadForces(),
  ]);
  const view: RootViewModel = { root, universe, filters, forces };
  const { html, script } = await buildGraphHtml(view);
  await editor.showPanel("modal", 100, html, script);
}

/**
 * Called from the panel via system.invokeFunction("object-graph.expandObject", ref).
 * Pure: takes a ref, returns an ExpansionResult, no side effects.
 */
export async function expandObject(ref: string): Promise<ExpansionResult> {
  return expandObjectImpl(ref);
}

/**
 * "Graph: Global Page Map" — all pages + every relation in the space,
 * pre-expanded. Filter state defaults to "mention only" and is not
 * persisted (so the local view's saved filters aren't disturbed).
 */
export async function showGlobalGraph() {
  invalidateGraphCache();
  const [root, universe] = await Promise.all([
    buildGlobalGraph((await editor.getCurrentPage()) ?? null),
    buildUniverse(),
  ]);
  if (!root) {
    await editor.flashNotification("Graph: no pages in space", "error");
    return;
  }
  // Default the global view to "mention only" — every other relation
  // label in the universe is hidden but can be toggled on without a
  // refetch (the full relation set is already loaded).
  const hiddenLabels = universe.labels.filter((l) => l !== "mention");
  const view: RootViewModel = {
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
  };
  const { html, script } = await buildGraphHtml(view);
  await editor.showPanel("modal", 100, html, script);
}

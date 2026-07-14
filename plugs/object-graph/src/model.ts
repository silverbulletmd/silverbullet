// The relation `kind` is either a reserved structural value (`mention`,
// `co-mention`) or a user predicate (e.g. `spouse`). Mirrors `plugs/index/relation.ts`.
export const STRUCTURAL_KINDS = new Set(["mention", "co-mention"]);

export type ObjectKind = "page" | "item" | "block" | "url" | "file";

/**
 * A node in the explored graph. Carries enough data for the panel to render
 * the node, drive filters, and populate the right-panel object view.
 */
export type ObjectNode = {
  ref: string;
  kind: ObjectKind;
  title: string;
  // Single core tag (page/item/task/block); drives the Root-tags filter.
  rootTag: string | null;
  // First non-core tag; drives node color. null when none.
  primaryTag: string | null;
  // All non-core tags; drives the Tags filter.
  tags: string[];
  dangling: boolean;
  // pageDecoration.prefix passthrough (e.g. emoji prefix).
  prefix?: string;
  // Full indexed payload, rendered verbatim into the object view.
  attributes: Record<string, unknown>;
};

export type EdgeProvenance = {
  page: string;
  pos?: number;
  snippet?: string;
};

/**
 * One edge between two ObjectNodes. Parallel typed edges between the same
 * pair stay distinct. Co-mention pairs in opposite directions are collapsed
 * into one record with `undirected: true`.
 */
export type Edge = {
  source: string;
  target: string;
  label: string; // == kind
  kind: string;
  refs: EdgeProvenance[];
  undirected: boolean;
};

export type ExpansionResult = {
  object: ObjectNode;
  neighbors: ObjectNode[];
  edges: Edge[];
};

export type Filters = {
  hiddenTags: string[];
  hiddenLabels: string[];
  // When true, edge labels on the canvas are suppressed entirely.
  hideEdgeLabels: boolean;
  // When true, nodes with no visible incoming or outgoing relation in
  // the current filter set are hidden (except the root).
  hideOrphans: boolean;
};

// Tunable force-simulation knobs exposed as sliders in the sidebar.
export type ForceSettings = {
  centerStrength: number;
  chargeStrength: number;
  linkDistance: number;
  linkStrength: number;
};

export const defaultForceSettings: ForceSettings = {
  centerStrength: 0.18,
  chargeStrength: -430,
  linkDistance: 223,
  linkStrength: 0.1,
};

export const defaultFilters: Filters = {
  hiddenTags: [],
  hiddenLabels: [],
  hideEdgeLabels: false,
  hideOrphans: true,
};

/**
 * Universe of filter options that exist in the whole space, regardless of
 * what the user has currently explored. Drives the sidebar's option lists
 * so checkboxes for not-yet-visible tags / labels remain togglable.
 * Counts in the sidebar still reflect the explored subgraph.
 */
export type GraphUniverse = {
  tags: string[];
  labels: string[];
};

export type RootViewModel = {
  root: ExpansionResult;
  universe: GraphUniverse;
  filters: Filters;
  forces: ForceSettings;
  /**
   * When true, the panel marks all of `root.neighbors` as already-expanded
   * (instead of the default ghost state). Used by the global view, which
   * ships every page at once and lets the user trim down rather than walk out.
   */
  initialAllExpanded?: boolean;
  /**
   * When false, the panel does not persist in-session filter changes back
   * to the datastore. Used by transient views like the global view so they
   * don't pollute the local-view filter preferences.
   */
  persistFilters?: boolean;
};

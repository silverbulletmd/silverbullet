/**
 * The admin search API's JSON (`/.dashboard/api/admin/search` and
 * `/.dashboard/api/admin/spaces/{id}/search`), as the server serialises it
 * (`server/src/multi/search_admin.rs`, `server-search/src/report.rs`).
 */

export type IndexKind = "fullText" | "semantic";

/** Pages (or, while downloading, bytes) done of a total. */
export type IndexProgressCount = { done: number; total: number };

export type IndexState =
  | { state: "starting" }
  /** Queued behind another space's build: builds run one at a time. */
  | { state: "waiting" }
  /** The semantic model is downloading (bytes). */
  | ({ state: "downloading" } & IndexProgressCount)
  /** A first build or a rebuild: `done` of `total` changed pages. */
  | ({ state: "building" } & IndexProgressCount)
  /** Answering; `catchUp` is a large reconcile running meanwhile. */
  | { state: "ready"; catchUp: IndexProgressCount | null }
  | { state: "failed"; reason: string };

export type IndexReport = IndexState & {
  kind: IndexKind;
  /** From the last finished build or catch-up; null before the first. */
  pages: number | null;
  bytes: number | null;
  memory: boolean;
  /** How long the last full build took, in seconds. */
  buildSecs: number | null;
};

export type CatalogModel = {
  id: string;
  displayName: string;
  languages: string;
  downloadBytes: number;
  residentBytes: number;
  license: string;
  homepage: string;
  notice: string;
};

export type ModelDownload =
  | { state: "missing" }
  | ({ state: "downloading" } & IndexProgressCount)
  | { state: "ready" }
  | { state: "failed"; message: string };

export type StoredModel = {
  id: string;
  displayName: string;
  bytes: number;
  complete: boolean;
  active: boolean;
};

/** Whether a space runs semantic search, and why not. */
export type SemanticSpaceState =
  | "on"
  | "offByChoice"
  | "offTooLarge"
  | "noModel";

/**
 * A space's stored `semanticSearch`: true (on), false (opted out) or null
 * (follow the server's default, on once a search model is chosen).
 */
export type SemanticChoice = boolean | null;

/** What the overview's rows and a space's own search info share. */
export type SpaceSearchCore = {
  semanticChoice: SemanticChoice;
  semantic: SemanticSpaceState;
  /** The pages its full-text index counts; null before they are counted. */
  pages: number | null;
  indexes: IndexReport[];
};

/** A space's row in the overview. */
export type SpaceSearchSummary = SpaceSearchCore & { name: string };

/** The search model: the one in use, the offered ones and the stored ones. */
export type SearchModelState = {
  /** The model in use; null for none. */
  model: string | null;
  catalog: CatalogModel[];
  /** Its download state; null without a model. */
  download: ModelDownload | null;
  stored: StoredModel[];
};

/** `GET`/`PUT /.dashboard/api/admin/search`. */
export type SearchOverview = SearchModelState & {
  /** Keyed by space id. */
  spaces: Record<string, SpaceSearchSummary>;
};

/**
 * The server's verdict on semantic search for a space, by its size, which
 * the dashboards show as given: `offByDefault` when it is off by default
 * for its size (a note shown checked or not; checking the box turns it on
 * explicitly), else `warning` when it keeps it above the limit.
 */
export type SemanticSearchOffer = {
  offByDefault: string | null;
  warning: string | null;
};

/** `GET /.dashboard/api/admin/spaces/{id}/search`. */
export type SpaceSearchInfo = SpaceSearchCore & { offer: SemanticSearchOffer };

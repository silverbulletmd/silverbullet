import type {
  ActionMeta,
  Decoration,
  Row,
} from "../../../plug-api/ui/tree_types.ts";

// Re-exported so the rest of the plug can keep importing these from
// "./types.ts" -- the shapes themselves live in the shared UI library because
// `TreeView` (and its supporting cast) need them too.
export type { ActionMeta, Decoration, Row };

export type FilterFields = Record<
  string,
  number | { weight: number; segments?: boolean }
>;

/**
 * One `navigator.handle` call's hook, matching the panel's four kinds of
 * bridge round trip (chrome, rows, per-row state, and the five interaction
 * callbacks) down to one name each.
 */
export type NavigatorHook =
  | "meta"
  | "rows"
  | "select"
  | "create"
  | "key"
  | "action"
  | "rowState"
  | "move";

/**
 * One entry of the ad-hoc segmented control, minus its Lua `where` predicate:
 * like `ActionMeta`, the panel only ever knows what to draw and which index to
 * hand back.
 */
export type SegmentMeta = {
  label: string;
  /**
   * A Feather name (bare or `feather:`-prefixed), or literal SVG markup (a
   * string starting with `<svg` after trimming leading whitespace) --
   * resolved to a node by the client (see engine.ts).
   */
  icon?: string;
  /** Whether the entry has a `where` predicate, i.e. needs a mask to subset. */
  hasWhere: boolean;
  /** The entry the view starts on when nothing is persisted. */
  default?: boolean;
  /**
   * Single character that activates this segment when typed into an empty
   * phrase (and is then dropped rather than filtered on). See `prefix.ts`.
   */
  prefix?: string;
  /** Input placeholder while this segment is active; overrides the view's. */
  placeholder?: string;
};

/** What a `source` is handed, in both search modes. */
export type SourceCtx = {
  phrase: string;
  /** Label of the active segment, if the view defines any. */
  segment?: string;
};

export type ViewMeta = {
  name: string;
  title: string;
  /**
   * Picker chrome: a short verb shown where the title otherwise goes ("Open",
   * "Run"), paired with a placeholder naming what is being picked. A docked
   * view can set this too (std.spaceTree does); absent, it just leaves the
   * title alone.
   */
  label?: string;
  /** Input placeholder; a segment's own `placeholder` wins over it. */
  placeholder?: string;
  /**
   * A leading occurrence of this character is dropped before ranking, for a
   * view whose rows are named without the sigil people type ("#work" finding
   * the row `work`).
   */
  stripPrefix?: string;
  mode: "list" | "tree";
  dock: "modal" | "lhs" | "rhs";
  /**
   * The `KeyboardEvent.key` of this view's own dock-opening command, lower
   *-cased, checked against a Ctrl/Cmd chord (never a bare key -- a filter
   * phrase must still be able to type it). Pressed while this dock already
   * has focus, it hides the dock instead of doing nothing: the same key
   * that opened it, pressed again from inside it, reads as "close". Unset
   * for a view with no such binding (most of them), and never checked for a
   * modal (see `handleKeyDown`'s use of it).
   */
  toggleKey?: string;
  hierarchy: { field: string; separator: string };
  foldersFirst: boolean;
  /**
   * Tree mode: every folder starts expanded, including one that arrives with a
   * later refresh. Inverts what the persisted set means -- see `expansionKey`
   * (`expansion.ts`) and `withExpanded` (the shared UI library's `tree_model.ts`).
   */
  expandAll: boolean;
  /**
   * What a tree's expansion/collapse state belongs to.
   *
   * `"view"` (the default) is right when the paths are globally unique -- a
   * page tree's rows mean the same thing whatever page you are on -- so the
   * state is persisted per view and outlives the session.
   *
   * `"page"` is for a tree built out of the *current page's* content, whose
   * paths mean nothing outside it. There the state is kept only while you are
   * on the page: never persisted, and dropped when the editor loads another
   * one. Without it a header collapsed on one page would arrive collapsed on
   * every other page with a header of that name.
   */
  expansionScope: "view" | "page";
  filterFields?: FilterFields;
  followEditor: boolean;
  refreshOn: string[];
  hasMove: boolean;
  hasCreate: boolean;
  /**
   * Whether re-opening an already-loaded view re-runs its source. For a view
   * whose rows are "as of now" -- recency ordering, the command palette's
   * cursor context -- the cached rows are the wrong answer by the time the
   * user asks again.
   */
  refreshOnOpen: boolean;
  /** Key names (KeyboardEvent.key) the view's `keymap` claims. */
  keys?: string[];
  /** Row actions, in the order they were declared. */
  actions?: ActionMeta[];
  /** Ad-hoc segments, in the order they were declared. */
  segments?: SegmentMeta[];
  /**
   * How many rows the list renders (and how many matches the filtered tree
   * auto-expands to) before the "N more" footer takes over.
   */
  limit: number;
  /**
   * `"client"`: the source runs once per load and the panel ranks/filters per
   * keystroke. `"source"`: phrase and segment changes re-invoke the source,
   * whose order is then authoritative.
   */
  search: "client" | "source";
  /**
   * Whether `presentation.row.icon` is defined. Rows reserve their icon slot
   * on this alone, so a view that icons only some of its objects still lines
   * up -- and one that icons none doesn't get indented for nothing.
   */
  hasRowIcon: boolean;
  /**
   * Single character -> the name of the view it routes to. Typed into an empty
   * phrase, it swaps this view out for that one in the same slot. See
   * `prefix.ts` for how the two prefix mechanisms differ.
   */
  prefixViews?: Record<string, string>;
  /**
   * The icon the create row draws with, resolved once with the view's
   * other chrome icons. A per-object icon can't serve here: the create row's
   * "object" is whatever is being typed, and resolving it would cost a round
   * trip per keystroke.
   */
  createIcon?: string;
  /** `Space` on an empty phrase completes a folder, `Alt-Space` a segment. */
  pathCompletion: boolean;
  /** A `#tag` in the phrase filters by tag instead of being ranked against. */
  hashtagFilter: boolean;
  /**
   * A `navigator.pick` registration: torn down after one use rather than kept
   * around for the session. Segment choice and tree expansion are never
   * persisted for it (see `expansion.ts`, `commands.ts`'s `pickSegment`), and
   * its `ViewState` is dropped from the panel's cache the moment it stops
   * being the slot's active view (see `engine.ts`'s `dropIfEphemeral`).
   */
  ephemeral?: boolean;
  /**
   * Whether a sidebar dock should be forced open at boot, overriding
   * whatever was last docked there. Space Lua-only: `navigator.define`
   * rejects it on a modal view, since a modal has nowhere to stay open.
   */
  openOnStart?: boolean;
  /**
   * Set by the plug's registry when this meta came from the built-in TS
   * registry rather than a Space Lua registration -- never set from Lua.
   * Lets the panel cache built-in meta indefinitely instead of re-resolving
   * it (a static map lookup, unlike a Lua registration) on every activation.
   */
  builtin?: boolean;
};

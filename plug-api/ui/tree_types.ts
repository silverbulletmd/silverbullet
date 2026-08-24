export type Decoration = {
  text?: string;
  icon?: string;
  cssClass?: string;
  position?: "left" | "right";
  /** Native tooltip, for a chip whose text is deliberately imprecise. */
  title?: string;
};

export type Row = {
  obj: Record<string, any>;
  primary: string;
  /**
   * What a *tree* row shows in place of its last path segment. For a view
   * whose hierarchy is synthesized rather than read off a name, the path is
   * what nests the row and this is what it reads as.
   */
  label?: string;
  description?: string;
  decorations?: Decoration[];
  /** Extra CSS classes for the row element itself. */
  cssClass?: string;
};

/**
 * A row action, minus whatever decides what it does and whether it applies:
 * the renderer only ever knows what to draw and which index to hand back.
 */
export type ActionMeta = {
  /**
   * A Feather name (bare or `feather:`-prefixed), or literal SVG markup (a
   * string starting with `<svg` after trimming leading whitespace) --
   * resolved to a node by the consuming plug.
   */
  icon?: string;
  label: string;
  /** Whether the action has a `when` predicate, i.e. needs a mask to show. */
  hasWhen: boolean;
  /** `"rw"` hides the action while the client is in read-only mode. */
  requireMode?: "rw";
};

/**
 * What a consumer has to say about one rendered thing: which actions apply to
 * it, and which icon it draws with. Meant to be computed for a whole batch at
 * once, never per hover, per keystroke, or per selection change.
 */
export type RowState = {
  /** Per-action `when` result, parallel to the action list. */
  actions?: boolean[];
  /** The row's icon, as a template node to clone. */
  icon?: Element;
};

/** Row state by rendered thing. Exactly one half is populated, per mode. */
export type RowStates = {
  /** Tree mode, keyed by node path -- covers folders and page/folder duals. */
  byPath?: Map<string, RowState>;
  /** List mode, keyed by the row itself. */
  byRow?: WeakMap<Row, RowState>;
};

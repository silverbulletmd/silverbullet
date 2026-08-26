import type {
  ActionMeta,
  Decoration,
  Row,
} from "../../plug-api/ui/tree_types.ts";

export type { ActionMeta, Decoration, Row };

export type FilterFields = Record<
  string,
  number | { weight: number; segments?: boolean }
>;

export type NavigatorHook =
  | "meta"
  | "rows"
  | "select"
  | "create"
  | "key"
  | "action"
  | "rowState"
  | "dropdown"
  | "move";

export type SegmentMeta = {
  label: string;
  icon?: string;
  hasWhere: boolean;
  default?: boolean;
  prefix?: string;
  placeholder?: string;
};

export type DropdownMeta = {
  placeholder?: string;
  allLabel?: string;
};

/** One selectable entry of a view's dropdown, as its `options` produced it. */
export type DropdownOption = {
  label: string;
  value: any;
};

export type SourceCtx = {
  phrase: string;
  segment?: string;
};

export type ViewMeta = {
  name: string;
  title: string;
  label?: string;
  placeholder?: string;
  stripPrefix?: string;
  mode: "list" | "tree";
  dock: "modal" | "lhs" | "rhs";
  hierarchy: { field: string; separator: string };
  foldersFirst: boolean;
  selectableFolders?: boolean;
  expandAll: boolean;
  expansionScope: "view" | "page";
  filterFields?: FilterFields;
  /** `filter = false`: no phrase filtering; the input is hidden but stays the
   * panel's focus home so the keyboard pipeline keeps working. */
  noFilter?: boolean;
  followEditor: boolean;
  refreshOn: string[];
  hasMove: boolean;
  hasCreate: boolean;
  refreshOnOpen: boolean;
  keys?: string[];
  actions?: ActionMeta[];
  segments?: SegmentMeta[];
  dropdown?: DropdownMeta;
  limit: number;
  search: "client" | "source";
  hasRowIcon: boolean;
  prefixViews?: Record<string, string>;
  createIcon?: string;
  pathCompletion: boolean;
  hashtagFilter: boolean;
  ephemeral?: boolean;
  openOnStart?: boolean;
  builtin?: boolean;
};

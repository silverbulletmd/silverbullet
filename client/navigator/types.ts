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
  | "content"
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
  dock?: string;
};

export const WINDOW_DOCKS = ["lhs", "rhs"] as const;
export const PAGE_DOCKS = ["page-top", "page-bottom"] as const;
export const ALL_DOCKS = [...WINDOW_DOCKS, "modal", ...PAGE_DOCKS] as const;

export function isPageDock(dock: string): boolean {
  return (PAGE_DOCKS as readonly string[]).includes(dock);
}
export function isWindowDock(dock: string): boolean {
  return (WINDOW_DOCKS as readonly string[]).includes(dock);
}

export type ViewMeta = {
  name: string;
  title: string;
  label?: string;
  placeholder?: string;
  stripPrefix?: string;
  mode: "list" | "tree";
  hasContent?: boolean;
  dock: (typeof ALL_DOCKS)[number];
  supportedDocks?: string[];
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
  defaultOpen?: boolean;
  builtin?: boolean;
};

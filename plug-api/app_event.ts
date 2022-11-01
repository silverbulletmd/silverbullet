import type { ParseTree } from "$sb/lib/tree.ts";
import { ParsedQuery } from "$sb/lib/query.ts";

export type AppEvent =
  | "page:click"
  | "page:complete"
  | "page:load"
  | "editor:init"
  | "plugs:loaded";

export type QueryProviderEvent = {
  query: ParsedQuery;
  pageName: string;
};

export type ClickEvent = {
  page: string;
  pos: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

export type IndexEvent = {
  name: string;
  text: string;
};

export type IndexTreeEvent = {
  name: string;
  tree: ParseTree;
};

import type { ParseTree } from "@silverbulletmd/common/tree";

export type AppEvent = "page:click" | "page:complete";

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

export type AppEvent = "app:ready" | "page:save" | "page:load" | "page:click";

export type ClickEvent = {
  pos: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

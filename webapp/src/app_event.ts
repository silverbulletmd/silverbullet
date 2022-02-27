export type AppEvent =
  | "app:ready"
  | "page:save"
  | "page:click"
  | "editor:complete";

export type ClickEvent = {
  pos: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

export type AppEvent =
  | "app:ready"
  | "page:save"
  | "page:click"
  | "page:index"
  | "editor:complete";

export type ClickEvent = {
  pos: number;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
};

export type IndexEvent = {
  name: string;
  text: string;
};

export interface AppEventDispatcher {
  dispatchAppEvent(name: AppEvent, data?: any): Promise<any[]>;
}

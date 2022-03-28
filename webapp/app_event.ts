export type AppEvent = "page:click" | "editor:complete";

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

export interface AppEventDispatcher {
  dispatchAppEvent(name: AppEvent, data?: any): Promise<any[]>;
}

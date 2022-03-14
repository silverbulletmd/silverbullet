import * as plugbox from "../../plugbox/src/types";

export type NuggetHook = {
  commands: {
    [key: string]: CommandDef;
  };
};

export type Manifest = plugbox.Manifest<NuggetHook>;

export type PageMeta = {
  name: string;
  lastModified: number;
  version?: number;
  lastOpened?: number;
};

export type AppCommand = {
  command: CommandDef;
  run: (arg: any) => Promise<any>;
};

export const slashCommandRegexp = /\/[\w\-]*/;

export interface CommandDef {
  // Function name to invoke
  invoke: string;

  // Bind to keyboard shortcut
  key?: string;
  mac?: string;

  // If to show in slash invoked menu and if so, with what label
  // should match slashCommandRegexp
  slashCommand?: string;
}

export type Notification = {
  id: number;
  message: string;
  date: Date;
};

export type AppViewState = {
  currentPage?: string;
  showPageNavigator: boolean;
  showCommandPalette: boolean;
  allPages: Set<PageMeta>;
  commands: Map<string, AppCommand>;
  notifications: Notification[];
};

export const initialViewState: AppViewState = {
  showPageNavigator: false,
  showCommandPalette: false,
  allPages: new Set(),
  commands: new Map(),
  notifications: [],
};

export type Action =
  | { type: "page-loaded"; name: string }
  | { type: "pages-listed"; pages: Set<PageMeta> }
  | { type: "start-navigate" }
  | { type: "stop-navigate" }
  | { type: "update-commands"; commands: Map<string, AppCommand> }
  | { type: "show-palette" }
  | { type: "hide-palette" }
  | { type: "show-notification"; notification: Notification }
  | { type: "dismiss-notification"; id: number };

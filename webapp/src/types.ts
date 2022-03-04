import { CommandDef } from "../../plugbox/src/types";

export type PageMeta = {
  name: string;
  lastModified: Date;
  created?: boolean;
  lastOpened?: Date;
};

export type AppCommand = {
  command: CommandDef;
  run: (arg: any) => Promise<any>;
};

export type AppViewState = {
  currentPage?: PageMeta;
  isSaved: boolean;
  showPageNavigator: boolean;
  showCommandPalette: boolean;
  allPages: PageMeta[];
  commands: Map<string, AppCommand>;
};

export const initialViewState: AppViewState = {
  isSaved: false,
  showPageNavigator: false,
  showCommandPalette: false,
  allPages: [],
  commands: new Map(),
};

export type Action =
  | { type: "page-loaded"; meta: PageMeta }
  | { type: "page-saved"; meta: PageMeta }
  | { type: "page-updated" }
  | { type: "pages-listed"; pages: PageMeta[] }
  | { type: "start-navigate" }
  | { type: "stop-navigate" }
  | { type: "update-commands"; commands: Map<string, AppCommand> }
  | { type: "show-palette" }
  | { type: "hide-palette" };

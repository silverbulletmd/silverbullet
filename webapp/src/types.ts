import { CommandDef } from "./plugins/types";

export type NuggetMeta = {
  name: string;
};

export type CommandContext = {
  text?: string;
};

export type AppCommand = {
  command: CommandDef;
  run: (ctx: CommandContext) => Promise<any>;
};

export type AppViewState = {
  currentNugget?: string;
  isSaved: boolean;
  showNuggetNavigator: boolean;
  showCommandPalette: boolean;
  allNuggets: NuggetMeta[];
  commands: Map<string, AppCommand>;
};

export const initialViewState: AppViewState = {
  isSaved: false,
  showNuggetNavigator: false,
  showCommandPalette: false,
  allNuggets: [],
  commands: new Map(),
};

export type Action =
  | { type: "nugget-loaded"; name: string }
  | { type: "nugget-saved" }
  | { type: "nugget-updated" }
  | { type: "nuggets-listed"; nuggets: NuggetMeta[] }
  | { type: "start-navigate" }
  | { type: "stop-navigate" }
  | { type: "update-commands"; commands: Map<string, AppCommand> }
  | { type: "show-palette" }
  | { type: "hide-palette" };

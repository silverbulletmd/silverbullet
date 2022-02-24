import { CommandDef } from "./plugins/types";

export type NoteMeta = {
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
  currentNote?: string;
  isSaved: boolean;
  showNoteNavigator: boolean;
  showCommandPalette: boolean;
  allNotes: NoteMeta[];
  commands: Map<string, AppCommand>;
};

export const initialViewState: AppViewState = {
  isSaved: false,
  showNoteNavigator: false,
  showCommandPalette: false,
  allNotes: [],
  commands: new Map(),
};

export type Action =
  | { type: "note-loaded"; name: string }
  | { type: "note-saved" }
  | { type: "note-updated" }
  | { type: "notes-listed"; notes: NoteMeta[] }
  | { type: "start-navigate" }
  | { type: "stop-navigate" }
  | { type: "update-commands"; commands: Map<string, AppCommand> }
  | { type: "show-palette" }
  | { type: "hide-palette" };

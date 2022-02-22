
export type NoteMeta = {
  name: string;
};

export type AppCommand = {
  name: string;
  run: () => void;
}

export type AppViewState = {
  currentNote: string;
  isSaved: boolean;
  showNoteNavigator: boolean;
  showCommandPalette: boolean;
  allNotes: NoteMeta[];
};

export type Action =
  | { type: "note-loaded"; name: string }
  | { type: "note-saved" }
  | { type: "note-updated" }
  | { type: "notes-listed"; notes: NoteMeta[] }
  | { type: "start-navigate" }
  | { type: "stop-navigate" }
  | { type: "show-palette" }
  | { type: "hide-palette" }
  ;


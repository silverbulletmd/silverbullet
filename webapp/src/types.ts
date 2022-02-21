
export type NoteMeta = {
  name: string;
};

export type AppViewState = {
  currentNote: string;
  isSaved: boolean;
  isFiltering: boolean;
  allNotes: NoteMeta[];
};

export type Action =
  | { type: "loaded"; name: string }
  | { type: "saved" }
  | { type: "start-navigate" }
  | { type: "stop-navigate" }
  | { type: "updated" }
  | { type: "notes-list"; notes: NoteMeta[] };


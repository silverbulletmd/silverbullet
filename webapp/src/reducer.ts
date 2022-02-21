import { Action, AppViewState } from "./types";

export default function reducer(state: AppViewState, action: Action): AppViewState {
  console.log("Got action", action)
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        currentNote: action.name,
        isSaved: true,
      };
    case "saved":
      return {
        ...state,
        isSaved: true,
      };
    case "updated":
      return {
        ...state,
        isSaved: false,
      };
    case "start-navigate":
      return {
        ...state,
        isFiltering: true,
      };
    case "stop-navigate":
      return {
        ...state,
        isFiltering: false,
      };
    case "notes-list":
      return {
        ...state,
        allNotes: action.notes,
      };
  }
}
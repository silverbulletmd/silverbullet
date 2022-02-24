import { Action, AppViewState } from "./types";

export default function reducer(
  state: AppViewState,
  action: Action
): AppViewState {
  console.log("Got action", action);
  switch (action.type) {
    case "note-loaded":
      return {
        ...state,
        currentNote: action.name,
        isSaved: true,
      };
    case "note-saved":
      return {
        ...state,
        isSaved: true,
      };
    case "note-updated":
      // Minor rerender optimization, this is triggered a lot
      if (!state.isSaved) {
        return state;
      }
      return {
        ...state,
        isSaved: false,
      };
    case "start-navigate":
      return {
        ...state,
        showNoteNavigator: true,
      };
    case "stop-navigate":
      return {
        ...state,
        showNoteNavigator: false,
      };
    case "notes-listed":
      return {
        ...state,
        allNotes: action.notes,
      };
    case "show-palette":
      return {
        ...state,
        showCommandPalette: true,
      };
    case "hide-palette":
      return {
        ...state,
        showCommandPalette: false,
      };
    case "update-commands":
      return {
        ...state,
        commands: action.commands,
      };
  }
  return state;
}

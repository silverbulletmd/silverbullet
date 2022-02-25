import { Action, AppViewState } from "./types";

export default function reducer(
  state: AppViewState,
  action: Action
): AppViewState {
  console.log("Got action", action);
  switch (action.type) {
    case "nugget-loaded":
      return {
        ...state,
        currentNugget: action.name,
        isSaved: true,
      };
    case "nugget-saved":
      return {
        ...state,
        isSaved: true,
      };
    case "nugget-updated":
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
        showNuggetNavigator: true,
      };
    case "stop-navigate":
      return {
        ...state,
        showNuggetNavigator: false,
      };
    case "nuggets-listed":
      return {
        ...state,
        allNuggets: action.nuggets,
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

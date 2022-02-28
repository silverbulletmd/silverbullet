import { Action, AppViewState } from "./types";

export default function reducer(
  state: AppViewState,
  action: Action
): AppViewState {
  console.log("Got action", action);
  switch (action.type) {
    case "page-loaded":
      return {
        ...state,
        allPages: state.allPages.map((pageMeta) =>
          pageMeta.name === action.meta.name
            ? { ...pageMeta, lastOpened: new Date() }
            : pageMeta
        ),
        currentPage: action.meta,
        isSaved: true,
      };
    case "page-saved":
      return {
        ...state,
        currentPage: action.meta,
        isSaved: true,
      };
    case "page-updated":
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
        showPageNavigator: true,
      };
    case "stop-navigate":
      return {
        ...state,
        showPageNavigator: false,
      };
    case "pages-listed":
      return {
        ...state,
        allPages: action.pages,
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

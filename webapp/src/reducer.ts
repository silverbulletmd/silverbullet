import { Action, AppViewState } from "./types";

export default function reducer(
  state: AppViewState,
  action: Action
): AppViewState {
  // console.log("Got action", action);
  switch (action.type) {
    case "page-loaded":
      return {
        ...state,
        allPages: new Set(
          [...state.allPages].map((pageMeta) =>
            pageMeta.name === action.name
              ? { ...pageMeta, lastOpened: Date.now() }
              : pageMeta
          )
        ),
        currentPage: action.name,
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
    case "show-notification":
      return {
        ...state,
        notifications: [action.notification, ...state.notifications],
      };
    case "dismiss-notification":
      return {
        ...state,
        notifications: state.notifications.filter((n) => n.id !== action.id),
      };
  }
  return state;
}

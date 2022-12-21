import { Action, AppViewState } from "./types.ts";

export default function reducer(
  state: AppViewState,
  action: Action,
): AppViewState {
  // console.log("Got action", action);
  switch (action.type) {
    case "page-loading":
      return {
        ...state,
        isLoading: true,
        currentPage: action.name,
      };
    case "page-loaded":
      return {
        ...state,
        isLoading: false,
        allPages: new Set(
          [...state.allPages].map((pageMeta) =>
            pageMeta.name === action.meta.name
              ? { ...pageMeta, lastOpened: Date.now() }
              : pageMeta
          ),
        ),
        perm: action.meta.perm,
        currentPage: action.meta.name,
      };
    case "page-changed":
      return {
        ...state,
        unsavedChanges: true,
      };
    case "page-saved":
      return {
        ...state,
        unsavedChanges: false,
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
    case "pages-listed": {
      // Let's move over any "lastOpened" times to the "allPages" list
      const oldPageMeta = new Map(
        [...state.allPages].map((pm) => [pm.name, pm]),
      );
      for (const pageMeta of action.pages) {
        const oldPageMetaItem = oldPageMeta.get(pageMeta.name);
        if (oldPageMetaItem && oldPageMetaItem.lastOpened) {
          pageMeta.lastOpened = oldPageMetaItem.lastOpened;
        }
      }
      return {
        ...state,
        allPages: action.pages,
      };
    }
    case "show-palette": {
      const commands = new Map(state.commands);
      for (const [k, v] of state.commands.entries()) {
        if (
          v.command.contexts &&
          (!action.context || !v.command.contexts.includes(action.context))
        ) {
          commands.delete(k);
        }
      }
      return {
        ...state,
        commands,
        showCommandPalette: true,
      };
    }
    case "hide-palette":
      return {
        ...state,
        showCommandPalette: false,
      };
    case "command-run":
      return {
        ...state,
        recentCommands: state.recentCommands.set(action.command, new Date()),
      };
    case "update-commands":
      return {
        ...state,
        commands: action.commands,
      };
    case "show-notification":
      return {
        ...state,
        notifications: [...state.notifications, action.notification],
      };
    case "dismiss-notification":
      return {
        ...state,
        notifications: state.notifications.filter((n) => n.id !== action.id),
      };
    case "show-panel":
      return {
        ...state,
        panels: {
          ...state.panels,
          [action.id]: action.config,
        },
      };
    case "hide-panel":
      return {
        ...state,
        panels: {
          ...state.panels,
          [action.id]: {},
        },
      };

    case "show-filterbox":
      return {
        ...state,
        showFilterBox: true,
        filterBoxOnSelect: action.onSelect,
        filterBoxPlaceHolder: action.placeHolder,
        filterBoxOptions: action.options,
        filterBoxLabel: action.label,
        filterBoxHelpText: action.helpText,
      };
    case "hide-filterbox":
      return {
        ...state,
        showFilterBox: false,
        filterBoxOnSelect: () => {},
        filterBoxPlaceHolder: "",
        filterBoxOptions: [],
        filterBoxHelpText: "",
      };
    case "set-ui-option":
      return {
        ...state,
        uiOptions: {
          ...state.uiOptions,
          [action.key]: action.value,
        },
      };
  }
  return state;
}

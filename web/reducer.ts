import type { Action, AppViewState } from "./ui_types.ts";
import type { PageMeta } from "../type/index.ts";
import {
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";

export default function reducer(
  state: AppViewState,
  action: Action,
): AppViewState {
  // console.log("Got action", action);
  switch (action.type) {
    case "document-editor-loaded":
      return {
        ...state,
        isLoading: false,
        current: {
          path: action.path,
          meta: action.meta,
        },
      };
    case "page-loaded": {
      const mouseDetected = globalThis.matchMedia("(pointer:fine)").matches;
      return {
        ...state,
        isLoading: false,
        isMobile: !mouseDetected,
        allPages: state.allPages.map((pageMeta) =>
          pageMeta.name === action.meta.name
            ? { ...pageMeta, lastOpened: Date.now() }
            : pageMeta
        ),
        current: {
          path: action.path,
          meta: action.meta as PageMeta,
        },
      };
    }
    case "document-editor-changed":
    case "page-changed":
      return {
        ...state,
        unsavedChanges: true,
      };
    case "document-editor-saved":
    case "page-saved": {
      return {
        ...state,
        unsavedChanges: false,
      };
    }
    case "update-current-page-meta": {
      // Update in the allPages list as well
      state.allPages = state.allPages.map((pageMeta) =>
        pageMeta.name === action.meta.name
          ? { ...action.meta, lastOpened: Date.now() }
          : pageMeta
      );
      // Can't update page meta if not on a page
      if (!state.current || !isMarkdownPath(state.current.path)) {
        return state;
      }
      return {
        ...state,
        current: {
          ...state.current,
          meta: action.meta,
        },
      };
    }
    case "sync-change":
      return {
        ...state,
        syncFailures: action.syncSuccess ? 0 : state.syncFailures + 1,
      };
    case "update-page-list": {
      // Let's move over any "lastOpened" times to the "allPages" list
      const oldPageMeta = new Map(
        [...state.allPages].map((pm) => [pm.name, pm]),
      );
      let currPageMeta: PageMeta | undefined;
      for (const pageMeta of action.allPages) {
        const oldPageMetaItem = oldPageMeta.get(pageMeta.name);
        if (oldPageMetaItem && oldPageMetaItem.lastOpened) {
          pageMeta.lastOpened = oldPageMetaItem.lastOpened;
        }
        if (parseToRef(pageMeta.name)?.path === state.current?.path) {
          currPageMeta = pageMeta;
        }
      }
      const newState = {
        ...state,
        allPages: action.allPages,
      };
      if (currPageMeta) {
        newState.current!.meta = currPageMeta;
      }
      return newState;
    }
    case "update-document-list": {
      return {
        ...state,
        allDocuments: action.allDocuments,
      };
    }
    case "start-navigate": {
      return {
        ...state,
        showPageNavigator: true,
        pageNavigatorMode: action.mode,
        showCommandPalette: false,
        showFilterBox: false,
      };
    }
    case "stop-navigate":
      return {
        ...state,
        showPageNavigator: false,
      };

    case "show-palette": {
      return {
        ...state,
        showCommandPalette: true,
        showPageNavigator: false,
        showFilterBox: false,
        showCommandPaletteContext: action.context,
      };
    }
    case "hide-palette":
      return {
        ...state,
        showCommandPalette: false,
        showCommandPaletteContext: undefined,
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
        showCommandPalette: false,
        showPageNavigator: false,
        showFilterBox: false,
        filterBoxOnSelect: () => {
        },
        filterBoxPlaceHolder: "",
        filterBoxOptions: [],
        filterBoxHelpText: "",
      };
    case "show-prompt":
      return {
        ...state,
        showPrompt: true,
        promptDefaultValue: action.defaultValue,
        promptMessage: action.message,
        promptCallback: action.callback,
      };
    case "hide-prompt":
      return {
        ...state,
        showPrompt: false,
        promptDefaultValue: undefined,
        promptMessage: undefined,
        promptCallback: undefined,
      };
    case "show-confirm":
      return {
        ...state,
        showConfirm: true,
        confirmMessage: action.message,
        confirmCallback: action.callback,
      };
    case "hide-confirm":
      return {
        ...state,
        showConfirm: false,
        confirmMessage: undefined,
        confirmCallback: undefined,
      };
    case "set-ui-option":
      return {
        ...state,
        uiOptions: {
          ...state.uiOptions,
          [action.key]: action.value,
        },
      };
    case "set-progress":
      return {
        ...state,
        progressPercentage: action.progressPercentage,
        progressType: action.progressType,
      };
  }
}

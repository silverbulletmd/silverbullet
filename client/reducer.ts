import type { Action, AppViewState } from "./types/ui.ts";
import type { PageMeta } from "../plug-api/types/index.ts";
import {
  isMarkdownPath,
  parseToRef,
} from "@silverbulletmd/silverbullet/lib/ref";

export default function reducer(
  state: AppViewState,
  action: Action,
): AppViewState {
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
      const isBrowser = globalThis.matchMedia(
        "(display-mode: browser)",
      ).matches;
      return {
        ...state,
        isLoading: false,
        isMobile: !mouseDetected,
        isStandalone: !isBrowser,
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
      state.allPages = state.allPages.map((pageMeta) =>
        pageMeta.name === action.meta.name
          ? { ...action.meta, lastOpened: Date.now() }
          : pageMeta,
      );
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
    case "online-status-change":
      return {
        ...state,
        isOnline: action.isOnline,
      };
    case "update-page-list": {
      const oldPageMeta = new Map(
        [...state.allPages].map((pm) => [pm.name, pm]),
      );
      let currPageMeta: PageMeta | undefined;
      for (const pageMeta of action.allPages) {
        const oldPageMetaItem = oldPageMeta.get(pageMeta.name);
        if (oldPageMetaItem?.lastOpened) {
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
    case "show-keyed-panel": {
      const incoming = action.config;
      const keyedPanels = state.keyedPanels.map((p) =>
        p.key === incoming.key
          ? {
              ...p,
              ...incoming,
              html: p.html === incoming.html ? p.html : incoming.html,
              script: p.script === incoming.script ? p.script : incoming.script,
              activationId: incoming.activationId ?? p.activationId,
            }
          : incoming.hidden || p.slot !== incoming.slot
            ? p
            : { ...p, hidden: true },
      );
      if (!keyedPanels.some((p) => p.key === incoming.key)) {
        keyedPanels.push(incoming);
      }
      return {
        ...state,
        keyedPanels,
        panels: incoming.hidden
          ? state.panels
          : {
              ...state.panels,
              [incoming.slot]: {},
            },
      };
    }
    case "hide-keyed-panel":
      return {
        ...state,
        keyedPanels: state.keyedPanels.map((p) =>
          p.key === action.key ? { ...p, hidden: true } : p,
        ),
      };
    case "mark-panel-ready":
      return {
        ...state,
        keyedPanels: state.keyedPanels.map((p) =>
          p.key === action.key ? { ...p, paintReady: true } : p,
        ),
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
        confirmDestructive: action.destructive,
        confirmCallback: action.callback,
      };
    case "hide-confirm":
      return {
        ...state,
        showConfirm: false,
        confirmMessage: undefined,
        confirmDestructive: undefined,
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

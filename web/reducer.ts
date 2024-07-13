import { Decoration } from "$lib/web.ts";
import { PageMeta } from "../plug-api/types.ts";
import { Action, AppViewState } from "../type/web.ts";

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
        panels: state.currentPage === action.name ? state.panels : {
          ...state.panels,
          // Hide these by default to avoid flickering
          top: {},
          bottom: {},
        },
      };
    case "page-loaded": {
      const mouseDetected = window.matchMedia("(pointer:fine)").matches;
      const pageMeta = state.allPages.find((p) => p.name == action.meta.name);
      const decor = state.settings.decorations?.filter((d) =>
        pageMeta?.tags?.some((t) => d.tag === t)
      );
      if (decor && decor.length > 0) {
        const mergedDecorations = decor.reduceRight((accumulator, el) => {
          accumulator = { ...accumulator, ...el };
          return accumulator;
        });
        if (mergedDecorations) {
          const { tag, ...currPageDecorations } = mergedDecorations;
          action.meta.pageDecorations = currPageDecorations;
        }
      }
      return {
        ...state,
        isLoading: false,
        isMobile: !mouseDetected,
        allPages: state.allPages.map((pageMeta) =>
          pageMeta.name === action.meta.name
            ? { ...pageMeta, lastOpened: Date.now() }
            : pageMeta
        ),
        currentPage: action.meta.name,
        currentPageMeta: action.meta,
      };
    }
    case "page-changed":
      return {
        ...state,
        unsavedChanges: true,
      };
    case "page-saved": {
      return {
        ...state,
        unsavedChanges: false,
      };
    }
    case "update-current-page-meta": {
      if (state.settings.decorations) {
        decoratePageMeta(
          action.meta,
          "",
          action.meta,
          state.settings.decorations,
        );
      }
      return {
        ...state,
        currentPageMeta: action.meta,
      };
    }
    case "sync-change":
      return {
        ...state,
        syncFailures: action.syncSuccess ? 0 : state.syncFailures + 1,
      };
    case "settings-loaded":
      return {
        ...state,
        settings: action.settings,
      };
    case "update-page-list": {
      // Let's move over any "lastOpened" times to the "allPages" list
      const oldPageMeta = new Map(
        [...state.allPages].map((pm) => [pm.name, pm]),
      );
      let currPageMeta = oldPageMeta.get(state.currentPage!);
      if (currPageMeta === undefined) {
        currPageMeta = {} as PageMeta;
      }
      for (const pageMeta of action.allPages) {
        const oldPageMetaItem = oldPageMeta.get(pageMeta.name);
        if (oldPageMetaItem && oldPageMetaItem.lastOpened) {
          pageMeta.lastOpened = oldPageMetaItem.lastOpened;
        }
        if (state.settings.decorations) {
          decoratePageMeta(
            pageMeta,
            state.currentPage!,
            currPageMeta,
            state.settings.decorations,
          );
        }
      }
      return {
        ...state,
        allPages: action.allPages,
        currentPageMeta: currPageMeta,
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
        progressPerc: action.progressPerc,
      };
  }
}

/**
 * Decorates (= attaches a pageDecorations field) to the pageMeta object when a matching decorator is found
 */
function decoratePageMeta(
  pageMeta: PageMeta,
  currentPage: string,
  currPageMeta: PageMeta,
  decorations: Decoration[],
) {
  const decor = decorations.filter((d) =>
    pageMeta.tags?.some((t: any) => d.tag === t)
  );
  // Page can have multiple decorations applied via different tags, accumulate them.
  // The decorations higher in the decorations list defined in SETTINGS gets
  // higher precedence.
  if (decor && decor.length > 0) {
    const mergedDecorations = decor.reduceRight((accumulator, el) => {
      accumulator = { ...accumulator, ...el };
      return accumulator;
    });
    if (mergedDecorations) {
      const { tag, ...currPageDecorations } = mergedDecorations;
      pageMeta.pageDecorations = currPageDecorations;
      if (pageMeta.name === currentPage) {
        currPageMeta!.pageDecorations = currPageDecorations;
      }
    }
  }
}

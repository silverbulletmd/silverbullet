import { closeSearchPanel } from "@codemirror/search";
import { runScopeHandlers } from "@codemirror/view";
import { getNameFromPath } from "@silverbulletmd/silverbullet/lib/ref";
import type {
  FilterOption,
  NotificationAction,
  NotificationType,
} from "@silverbulletmd/silverbullet/type/client";
import { notificationDismissTimeouts } from "@silverbulletmd/silverbullet/type/client";
import { h, render as preactRender } from "preact";
import { useEffect, useReducer } from "preact/hooks";
import * as featherIcons from "preact-feather";
import type { Client } from "./client.ts";
import { Confirm, Prompt } from "./components/basic_modals.tsx";
import { isMacLike, keyboardHint } from "../plug-api/lib/shortcut.ts";
import { kebabToPascal } from "./lib/feather_icons.ts";
import { FilterList } from "./components/filter.tsx";
import { NavigatorDock, NavigatorModal } from "./navigator/ui/panels.tsx";
import { RevisionPreviewModal } from "./navigator/ui/components/revision_preview.tsx";
import { useNavigatorSlot } from "./navigator/ui/slots.ts";
import { Panel } from "./components/panel.tsx";
import { TopBar } from "./components/top_bar.tsx";
import * as mdi from "./filtered_material_icons.ts";
import reducer from "./reducer.ts";
import {
  type Action,
  type AppViewState,
  initialViewState,
} from "./types/ui.ts";

export class MainUI {
  viewState: AppViewState = initialViewState;

  constructor(private client: Client) {
    // Safari treats Cmd-O as its own "Open File..." shortcut and wins before
    // any bubble-phase listener -- including CodeMirror's own keymap and the
    // bubble-phase fallback right below -- ever sees the keydown. Caught here
    // at capture phase, ahead of that default, and only prevented when a
    // handler actually claims it (an unbound Cmd-O still opens Safari's
    // dialog, same as before). `stopPropagation` keeps the bubble-phase
    // listeners from also matching the same chord and running it twice.
    globalThis.addEventListener(
      "keydown",
      (ev) => {
        const cmd = isMacLike ? ev.metaKey : ev.ctrlKey;
        if (!cmd || ev.altKey || ev.shiftKey || ev.key.toLowerCase() !== "o") {
          return;
        }
        if (runScopeHandlers(client.editorView, ev, "editor")) {
          ev.preventDefault();
          ev.stopPropagation();
        }
      },
      { capture: true },
    );

    // Make keyboard shortcuts work even when the editor is in read only mode or not focused
    globalThis.addEventListener("keydown", (ev) => {
      if (!client.editorView.hasFocus) {
        const target = ev.target as HTMLElement;
        if (target.className === "cm-textfield" && ev.key === "Escape") {
          console.log("Closing search panel");
          closeSearchPanel(client.editorView);
          return;
        } else if (
          target.className === "cm-textfield" ||
          target.closest(".cm-content") ||
          target.closest(".cm-vim-panel")
        ) {
          return;
        } else if (
          target.closest('input, textarea, select, [contenteditable="true"]')
        ) {
          // Focus is in a native form field (e.g. the top-bar page-name
          // editor). Let the field own keys it handles natively — typing,
          // caret navigation, and the standard clipboard/undo/select-all
          // combos — but still forward genuine command shortcuts (e.g. Cmd-K)
          // so they keep working from the field, like they did in the old
          // CodeMirror mini-editor.
          const cmd = ev.metaKey || ev.ctrlKey;
          const key = ev.key.toLowerCase();
          const fieldHandlesNatively =
            !cmd ||
            ["a", "c", "v", "x", "z", "y"].includes(key) ||
            [
              "arrowleft",
              "arrowright",
              "arrowup",
              "arrowdown",
              "home",
              "end",
              "backspace",
              "delete",
            ].includes(key);
          if (fieldHandlesNatively) {
            return;
          }
        }
        if (runScopeHandlers(client.editorView, ev, "editor")) {
          ev.preventDefault();
        }
      }
    });

    globalThis.addEventListener("touchstart", (ev) => {
      if (ev.touches.length === 2) {
        ev.stopPropagation();
        ev.preventDefault();
        void client.startPageNavigate("page");
      }
      if (ev.touches.length === 3) {
        ev.stopPropagation();
        ev.preventDefault();
        void client.startCommandPalette();
      }
    });

    globalThis.addEventListener("mouseup", (_) => {
      setTimeout(() => {
        client.editorView.dispatch({});
      });
    });
  }

  private progressMap = new Map<
    "index" | "sync",
    {
      percentage: number;
      timeout: ReturnType<typeof setTimeout>;
    }
  >();

  viewDispatch: (action: Action) => void = () => {};

  flashNotification(
    message: string,
    type: NotificationType = "info",
    options?: {
      timeout?: number;
      actions?: NotificationAction[];
    },
  ) {
    const id = Math.floor(Math.random() * 1000000);
    const dismiss = () => {
      this.viewDispatch({ type: "dismiss-notification", id });
    };
    const persistent = options?.timeout === 0;
    const actions = options?.actions?.map((action) => ({
      name: action.name,
      run: () => {
        action.run();
        dismiss();
      },
    }));
    this.viewDispatch({
      type: "show-notification",
      notification: {
        id,
        type,
        message,
        date: new Date(),
        actions,
        persistent,
      },
    });
    if (!persistent) {
      const timeout = options?.timeout ?? notificationDismissTimeouts[type];
      setTimeout(dismiss, timeout);
    }
  }

  private dispatchProgressState() {
    if (this.progressMap.size === 0) {
      this.viewDispatch({ type: "set-progress" });
      return;
    }

    // Sync takes precedence over index so the indicator
    // doesn't flip between the two when both streams are firing.
    const progressType: "sync" | "index" = this.progressMap.has("sync")
      ? "sync"
      : "index";
    const entry = this.progressMap.get(progressType);
    if (entry) {
      this.viewDispatch({
        type: "set-progress",
        progressPercentage: entry.percentage,
        progressType,
      });
    }
  }

  private removeProgressType(progressType: "index" | "sync") {
    const entry = this.progressMap.get(progressType);
    if (entry) {
      clearTimeout(entry.timeout);
      this.progressMap.delete(progressType);
    }
  }

  showProgress(progressType: "sync" | "index", progressPercentage?: number) {
    this.removeProgressType(progressType);

    if (progressPercentage !== undefined) {
      const timeout = setTimeout(() => {
        this.removeProgressType(progressType);
        this.dispatchProgressState();
      }, 5000);
      this.progressMap.set(progressType, {
        percentage: progressPercentage,
        timeout,
      });
    }

    this.dispatchProgressState();
  }

  filterBox(
    label: string,
    options: FilterOption[],
    helpText = "",
    placeHolder = "",
  ): Promise<FilterOption | undefined> {
    return new Promise((resolve) => {
      this.viewDispatch({
        type: "show-filterbox",
        label,
        options,
        placeHolder,
        helpText,
        onSelect: (option: any) => {
          this.viewDispatch({ type: "hide-filterbox" });
          this.client.focus();
          resolve(option);
        },
      });
    });
  }

  prompt(message: string, defaultValue = ""): Promise<string | undefined> {
    return new Promise((resolve) => {
      this.viewDispatch({
        type: "show-prompt",
        message,
        defaultValue,
        callback: (value: string | undefined) => {
          this.viewDispatch({ type: "hide-prompt" });
          this.client.focus();
          resolve(value);
        },
      });
    });
  }

  confirm(
    message: string,
    options?: { destructive?: boolean },
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.viewDispatch({
        type: "show-confirm",
        message,
        destructive: options?.destructive,
        callback: (value: boolean) => {
          this.viewDispatch({ type: "hide-confirm" });
          this.client.focus();
          resolve(value);
        },
      });
    });
  }

  ViewComponent() {
    const [viewState, dispatch] = useReducer(reducer, initialViewState);
    this.viewState = viewState;
    this.viewDispatch = dispatch;

    const client = this.client;

    const navSlots = {
      lhs: useNavigatorSlot("lhs"),
      rhs: useNavigatorSlot("rhs"),
      modal: useNavigatorSlot("modal"),
    };

    useEffect(() => {
      if (viewState.current) {
        document.title =
          (this.client.currentPageMeta()?.pageDecoration?.prefix ?? "") +
          getNameFromPath(viewState.current.path);
      }
    }, [viewState.current]);

    useEffect(() => {
      void this.client.rebuildEditorState();
      void this.client.dispatchAppEvent("editor:modeswitch");
    }, [viewState.uiOptions.vimMode]);

    useEffect(() => {
      const updateTheme = () => {
        const darkMode =
          viewState.uiOptions.darkMode === undefined
            ? globalThis.matchMedia("(prefers-color-scheme: dark)").matches
            : viewState.uiOptions.darkMode;

        document.documentElement.dataset.theme = darkMode ? "dark" : "light";

        if (this.client.contentManager.isDocumentEditor()) {
          this.client.contentManager.documentEditor.updateTheme();
        }
      };

      updateTheme();

      if (viewState.uiOptions.darkMode === undefined) {
        const mediaQuery = globalThis.matchMedia(
          "(prefers-color-scheme: dark)",
        );
        mediaQuery.addEventListener("change", updateTheme);

        return () => {
          mediaQuery.removeEventListener("change", updateTheme);
        };
      }
    }, [viewState.uiOptions.darkMode]);

    useEffect(() => {
      document.documentElement.dataset.markdownSyntaxRendering = viewState
        .uiOptions.markdownSyntaxRendering
        ? "on"
        : "off";
    }, [viewState.uiOptions.markdownSyntaxRendering]);

    // A navigator dock reserves top-bar space the same way a plug's own
    // sidebar panel does, falling back to that panel's mode when no dock is
    // open so nothing changes for a plug that has one.
    const sidebarSpacer = (slot: "lhs" | "rhs") => {
      const mode = navSlots[slot]?.mode ?? viewState.panels[slot].mode;
      if (!mode) {
        return false;
      }
      // The navigator's spacer deliberately doesn't carry the classic "panel"
      // class: space styles that target `#sb-top .panel` (a common hack to
      // neutralize the classic spacer) would otherwise break the title
      // alignment this spacer exists for.
      return (
        <div
          className={navSlots[slot] ? "sb-nav-spacer" : "panel"}
          style={{ flex: mode }}
        />
      );
    };
    const navDockSignature = (["lhs", "rhs"] as const)
      .map((slot) => `${slot}:${navSlots[slot]?.mode ?? ""}`)
      .join(",");

    useEffect(() => {
      // Need to dispatch a resize event so that the top_bar can pick it up
      globalThis.dispatchEvent(new Event("resize"));
    }, [viewState.panels, navDockSignature]);

    const actionButtons = client.config.get<ActionButton[]>(
      "actionButtons",
      [],
    );

    // One modal at a time, last open wins: a navigator modal taking the slot
    // closes the plug panel that had it, the way the keyed-panel reducer case
    // used to. Both on screen means two stacked backdrops, with the
    // navigator's (and the focus it took) hidden under the plug's.
    const plugModalMode = viewState.panels.modal.mode;
    useEffect(() => {
      if (navSlots.modal && plugModalMode !== undefined) {
        dispatch({ type: "hide-panel", id: "modal" });
      }
    }, [navSlots.modal, plugModalMode]);
    const modalVisible = plugModalMode !== undefined && !navSlots.modal;
    const modalInset = plugModalMode;

    const bhsVisible = viewState.panels.bhs.mode !== undefined;

    return (
      <>
        {viewState.showFilterBox && (
          <FilterList
            label={viewState.filterBoxLabel}
            placeholder={viewState.filterBoxPlaceHolder}
            options={viewState.filterBoxOptions}
            darkMode={viewState.uiOptions.darkMode}
            allowNew={false}
            helpText={viewState.filterBoxHelpText}
            onSelect={viewState.filterBoxOnSelect}
          />
        )}
        {viewState.showPrompt && (
          <Prompt
            message={viewState.promptMessage!}
            defaultValue={viewState.promptDefaultValue}
            darkMode={viewState.uiOptions.darkMode}
            callback={(value) => {
              dispatch({ type: "hide-prompt" });
              viewState.promptCallback!(value);
            }}
          />
        )}
        {viewState.showConfirm && (
          <Confirm
            message={viewState.confirmMessage!}
            destructive={viewState.confirmDestructive}
            callback={(value) => {
              dispatch({ type: "hide-confirm" });
              viewState.confirmCallback!(value);
            }}
          />
        )}
        <TopBar
          pageName={
            !viewState.current ? "" : getNameFromPath(viewState.current.path)
          }
          notifications={viewState.notifications}
          onDismissNotification={(id) => {
            dispatch({ type: "dismiss-notification", id });
          }}
          isOnline={viewState.isOnline}
          unsavedChanges={viewState.unsavedChanges}
          isLoading={viewState.isLoading}
          progressPercentage={viewState.progressPercentage}
          progressType={viewState.progressType}
          onRename={async (newName) => {
            if (client.contentManager.isDocumentEditor()) {
              if (!newName) return;

              console.log("Now renaming document to...", newName);
              await client.clientSystem.system.invokeFunction(
                "index.renameDocumentCommand",
                [{ document: newName }],
              );
            } else {
              if (!newName) {
                client.editorView.dispatch({
                  selection: { anchor: 0 },
                });
                client.focus();
                return;
              }
              console.log("Now renaming page to...", newName);
              await client.clientSystem.system.invokeFunction(
                "index.renamePageCommand",
                [{ page: newName }],
              );
              client.focus();
            }
          }}
          actionButtons={[
            ...(viewState.isMobile &&
            client.config
              .get<string>("mobileMenuStyle", "hamburger")
              .includes("hamburger")
              ? [
                  {
                    icon: featherIcons.Menu,
                    description: "Open Menu",
                    class: "expander",
                    callback: () => {
                      document
                        .querySelector("#sb-top .sb-actions.hamburger")
                        ?.classList.toggle("open");
                    },
                  },
                ]
              : []),
            ...actionButtons
              .filter(
                (button) =>
                  button.icon &&
                  (typeof button.mobile === "undefined" ||
                    button.mobile === viewState.isMobile) &&
                  (typeof button.standalone === "undefined" ||
                    button.standalone === viewState.isStandalone),
              )
              .map((button, index) => ({
                ...button,
                priority: button.priority ?? actionButtons.length - index,
              }))
              .sort((a, b) => b.priority - a.priority)
              .map((button) => {
                const iconName = kebabToPascal(button.icon);
                const mdiIcon = (mdi as any)[iconName];
                let featherIcon = (featherIcons as any)[iconName];
                if (!featherIcon) {
                  featherIcon = featherIcons.HelpCircle;
                }
                let description = button.description || "";
                if (button.command) {
                  const cmd = viewState.commands.get(button.command);
                  if (cmd) {
                    const hint = keyboardHint(cmd);
                    if (hint) {
                      description = description
                        ? `${description} (${hint})`
                        : hint;
                    }
                  }
                }

                return {
                  icon: mdiIcon ? mdiIcon : featherIcon,
                  description,
                  dropdown: button.dropdown,
                  callback: button.command
                    ? () => this.client.runCommandByName(button.command!)
                    : button.run ||
                      (() => {
                        this.flashNotification(
                          "actionButton did not specify a command or run() callback",
                          "error",
                        );
                      }),
                  href: "",
                };
              }),
          ]}
          rhs={sidebarSpacer("rhs")}
          lhs={sidebarSpacer("lhs")}
          pageNamePrefix={
            client.currentPageMeta()?.pageDecoration?.prefix ?? ""
          }
          cssClass={(client.currentPageMeta()?.pageDecoration?.cssClasses ?? [])
            .join(" ")
            .replaceAll(/[^a-zA-Z0-9-_ ]/g, "")}
          mobileMenuStyle={
            viewState.isMobile
              ? client.config.get<string>("mobileMenuStyle", "hamburger")
              : undefined
          }
          readOnly={
            viewState.uiOptions.forcedROMode || client.bootConfig.readOnly
          }
        />
        <div id="sb-main">
          <NavigatorDock slot="lhs" state={navSlots.lhs} client={client} />
          {viewState.panels.lhs.mode !== undefined && (
            <Panel config={viewState.panels.lhs} editor={client} slot="lhs" />
          )}
          <div id="sb-editor" />
          {viewState.panels.rhs.mode !== undefined && (
            <Panel config={viewState.panels.rhs} editor={client} slot="rhs" />
          )}
          <NavigatorDock slot="rhs" state={navSlots.rhs} client={client} />
        </div>
        <NavigatorModal state={navSlots.modal} client={client} />
        <RevisionPreviewModal />
        {modalVisible && (
          <div className="sb-modal-backdrop">
            <div
              className="sb-modal"
              style={{
                inset:
                  typeof modalInset === "number"
                    ? `${modalInset}px`
                    : modalInset,
              }}
            >
              <Panel
                config={viewState.panels.modal}
                editor={client}
                slot="modal"
              />
            </div>
          </div>
        )}
        {bhsVisible && (
          <div className="sb-bhs">
            <Panel config={viewState.panels.bhs} editor={client} slot="bhs" />
          </div>
        )}
      </>
    );
  }

  render(container: Element) {
    container.innerHTML = "";
    preactRender(h(this.ViewComponent.bind(this), {}), container);
  }
}

type ActionButton = {
  icon: string;
  description?: string;
  command?: string;
  mobile?: boolean;
  standalone?: boolean;
  dropdown?: boolean;
  priority?: number;
  run?: () => void;
};

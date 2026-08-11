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
import { useEffect, useLayoutEffect, useReducer, useRef } from "preact/hooks";
import * as featherIcons from "preact-feather";
import type { Client } from "./client.ts";
import { Confirm, Prompt } from "./components/basic_modals.tsx";
import { keyboardHint } from "../plug-api/lib/shortcut.ts";
import { kebabToPascal } from "./lib/feather_icons.ts";
import { FilterList } from "./components/filter.tsx";
import { Panel } from "./components/panel.tsx";
import { TopBar } from "./components/top_bar.tsx";
import * as mdi from "./filtered_material_icons.ts";
import reducer from "./reducer.ts";
import {
  type Action,
  type AppViewState,
  initialViewState,
  type PanelSlot,
} from "./types/ui.ts";

export class MainUI {
  viewState: AppViewState = initialViewState;

  constructor(private client: Client) {
    // Make keyboard shortcuts work even when the editor is in read only mode or not focused
    globalThis.addEventListener("keydown", (ev) => {
      if (!client.editorView.hasFocus) {
        const target = ev.target as HTMLElement;
        if (target.className === "cm-textfield" && ev.key === "Escape") {
          // Search panel is open, let's close it
          console.log("Closing search panel");
          closeSearchPanel(client.editorView);
          return;
        } else if (
          target.className === "cm-textfield" ||
          target.closest(".cm-content") ||
          target.closest(".cm-vim-panel")
        ) {
          // In some cm element, let's back out
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
          // Otherwise fall through and forward the shortcut to the editor.
        }
        if (runScopeHandlers(client.editorView, ev, "editor")) {
          ev.preventDefault();
        }
      }
    });

    globalThis.addEventListener("touchstart", (ev) => {
      // Launch the page picker on a two-finger tap
      if (ev.touches.length === 2) {
        ev.stopPropagation();
        ev.preventDefault();
        void client.startPageNavigate("page");
      }
      // Launch the command palette using a three-finger tap
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

  // Progress circle handling
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
    // Hide when nothing is active
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

    // A visible keyed lhs/rhs panel (a sidebar dock) reserves top-bar space
    // the same way the classic keyless panel does, fall back to the keyless
    // panel's mode when no keyed panel is visible so that behavior is
    // unchanged for plugs that don't use keyed panels.
    const sidebarSpacer = (slot: "lhs" | "rhs") => {
      const keyed = viewState.keyedPanels.find(
        (p) => p.slot === slot && !p.hidden,
      );
      const mode = keyed?.mode ?? viewState.panels[slot].mode;
      if (!mode) {
        return false;
      }
      // The keyed spacer deliberately doesn't carry the classic "panel"
      // class: space styles that target `#sb-top .panel` (a common hack to
      // neutralize the classic spacer) would otherwise break the title
      // alignment this spacer exists for.
      return (
        <div
          className={keyed ? "sb-keyed-spacer" : "panel"}
          style={{ flex: mode }}
        />
      );
    };
    const sidebarKeyedSignature = viewState.keyedPanels
      .filter((p) => p.slot === "lhs" || p.slot === "rhs")
      .map((p) => `${p.key}:${p.hidden}:${p.mode}`)
      .join(",");

    useEffect(() => {
      // Need to dispatch a resize event so that the top_bar can pick it up
      globalThis.dispatchEvent(new Event("resize"));
    }, [viewState.panels, sidebarKeyedSignature]);

    // A visible keyed modal panel covers the screen with a fixed backdrop, and
    // only code inside its iframe can call hidePanel. If that iframe fails to
    // boot there is no way out, so answer Escape here too. The iframe swallows
    // its own keystrokes when focused, so this only fires when it hasn't got
    // focus — precisely the stuck case.
    const trappedModalKey = viewState.keyedPanels.find(
      (p) => p.slot === "modal" && !p.hidden,
    )?.key;

    // Layout effect, not effect: a plain effect is flushed after paint, which
    // leaves the modal on screen and focusable for a frame with no Escape
    // handler attached — long enough for a real keystroke to fall through.
    useLayoutEffect(() => {
      if (!trappedModalKey) {
        return;
      }
      const onKeyDown = (ev: KeyboardEvent) => {
        if (ev.key !== "Escape") {
          return;
        }
        ev.preventDefault();
        dispatch({ type: "hide-keyed-panel", key: trappedModalKey });
        client.focus();
      };
      globalThis.addEventListener("keydown", onKeyDown);
      return () => globalThis.removeEventListener("keydown", onKeyDown);
    }, [trappedModalKey]);
    const actionButtons = client.config.get<ActionButton[]>(
      "actionButtons",
      [],
    );

    const keyedFor = (slot: PanelSlot) =>
      viewState.keyedPanels
        .filter((p) => p.slot === slot)
        .map((p) => (
          <div
            key={p.key}
            className={`sb-keyed-panel sb-keyed-panel-${slot}${
              p.hidden ? " sb-hidden" : ""
            }`}
            style={{ flex: p.mode }}
          >
            <Panel config={p} editor={client} slot={slot} />
          </div>
        ));

    const keyedModalPanels = viewState.keyedPanels.filter(
      (p) => p.slot === "modal",
    );
    const visibleKeyedModalPanel = keyedModalPanels.find((p) => !p.hidden);
    const modalVisible =
      viewState.panels.modal.mode !== undefined ||
      visibleKeyedModalPanel !== undefined;
    const modalInset =
      viewState.panels.modal.mode ?? visibleKeyedModalPanel?.mode;
    const centeredModal =
      viewState.panels.modal.mode === undefined &&
      visibleKeyedModalPanel !== undefined;
    const modalRef = useRef<HTMLDivElement>(null);

    // A `ResizeObserver` watching a *cross-document* target (the iframe's own
    // `documentElement`, observed from here in the host) isn't tied to this
    // document's rendering cadence -- measured over a second late here with
    // nothing else forcing a host repaint, and a single-row picker's reveal
    // landing on a stale, too-short height is exactly what a lag that size
    // produces (the row itself renders inside the iframe just fine; the
    // host's box around it just hasn't grown to match yet). A `requestAnimationFrame`
    // loop instead re-measures on the *host's* own render cadence, which is
    // what's actually driving what's on screen -- reliable regardless of
    // whatever the iframe's document is doing, and self-correcting every
    // frame rather than waiting on a notification that may not come.
    useLayoutEffect(() => {
      const el = modalRef.current;
      if (!el || !centeredModal) return;
      const doc = el.querySelector("iframe")?.contentDocument;
      if (!doc) return;
      // `.sb-modal-centered` is `box-sizing: border-box`, so the height this
      // sets is the *outer* (bordered) box -- but the iframe rendering the
      // measured content lives inside that border, in the content box. Not
      // adding the border back in landed the applied height a couple of
      // pixels short of what the iframe actually needed, clipping the bottom
      // of the last row by exactly that much (most visible with few rows,
      // where there's no leftover slack from a taller previous state to hide
      // it in).
      const cs = getComputedStyle(el);
      const borderY = parseFloat(cs.borderTopWidth) +
        parseFloat(cs.borderBottomWidth);
      const apply = () => {
        const height = doc.documentElement.getBoundingClientRect().height;
        if (height > 0) el.style.height = `${Math.ceil(height + borderY)}px`;
      };
      apply();
      let frame = requestAnimationFrame(function tick() {
        apply();
        frame = requestAnimationFrame(tick);
      });
      return () => cancelAnimationFrame(frame);
    }, [
      centeredModal,
      visibleKeyedModalPanel?.key,
      modalVisible,
      visibleKeyedModalPanel?.paintReady,
    ]);

    const keyedBhsPanels = viewState.keyedPanels.filter(
      (p) => p.slot === "bhs",
    );
    const bhsVisible =
      viewState.panels.bhs.mode !== undefined ||
      keyedBhsPanels.some((p) => !p.hidden);

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
                // Always move cursor to the start of the page
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
            // Vertical menu button
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
                      // Make the expander button open/close the menu via toggling the CSS class "open"
                      document
                        .querySelector("#sb-top .sb-actions.hamburger")
                        ?.classList.toggle("open");
                    },
                  },
                ]
              : []),
            // Custom action buttons
            ...actionButtons
              .filter(
                (
                  // Filter out buttons without icons (invalid) and mobile buttons when not in mobile mode
                  button,
                ) =>
                  button.icon &&
                  (typeof button.mobile === "undefined" ||
                    button.mobile === viewState.isMobile) &&
                  (typeof button.standalone === "undefined" ||
                    button.standalone === viewState.isStandalone),
              )
              // Then ensure all buttons have a priority set (by default based on array index)
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
                // Build description with keyboard shortcut hint
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
          {keyedFor("lhs")}
          {viewState.panels.lhs.mode !== undefined && (
            <Panel config={viewState.panels.lhs} editor={client} slot="lhs" />
          )}
          <div id="sb-editor" />
          {viewState.panels.rhs.mode !== undefined && (
            <Panel config={viewState.panels.rhs} editor={client} slot="rhs" />
          )}
          {keyedFor("rhs")}
        </div>
        {(viewState.panels.modal.mode !== undefined ||
          keyedModalPanels.length > 0) && (
          <div
            className={"sb-modal-backdrop" + (modalVisible ? "" : " sb-hidden")}
            onClick={(ev) => {
              // Only a click on the backdrop itself, and only for keyed panels
              // — keyless modal panels keep their click-through behavior.
              if (ev.target !== ev.currentTarget || !visibleKeyedModalPanel) {
                return;
              }
              dispatch({
                type: "hide-keyed-panel",
                key: visibleKeyedModalPanel.key,
              });
              client.focus();
            }}
          >
            <div
              ref={modalRef}
              className={
                "sb-modal" + (centeredModal ? " sb-modal-centered" : "") +
                (visibleKeyedModalPanel?.paintReady === false
                  ? " sb-modal-paint-pending"
                  : "")
              }
              style={(() => {
                const inset =
                  typeof modalInset === "number"
                    ? `${modalInset}px`
                    : modalInset;
                return centeredModal
                  ? {
                      top: inset,
                      // The height itself is written by the layout effect
                      // above; this is only how far it may ever reach.
                      maxHeight:
                        typeof modalInset === "number"
                          ? `calc(100% - ${modalInset * 2}px)`
                          : undefined,
                    }
                  : { inset };
              })()}
            >
              {viewState.panels.modal.mode !== undefined && (
                <Panel
                  config={viewState.panels.modal}
                  editor={client}
                  slot="modal"
                />
              )}
              {keyedModalPanels.map((p) => (
                <div
                  key={p.key}
                  className={"sb-keyed-panel" + (p.hidden ? " sb-hidden" : "")}
                  style={{ flex: p.mode }}
                >
                  <Panel config={p} editor={client} slot="modal" />
                </div>
              ))}
            </div>
          </div>
        )}
        {(viewState.panels.bhs.mode !== undefined ||
          keyedBhsPanels.length > 0) && (
          <div className={"sb-bhs" + (bhsVisible ? "" : " sb-hidden")}>
            {viewState.panels.bhs.mode !== undefined && (
              <Panel config={viewState.panels.bhs} editor={client} slot="bhs" />
            )}
            {keyedBhsPanels.map((p) => (
              <div
                key={p.key}
                className={"sb-keyed-panel" + (p.hidden ? " sb-hidden" : "")}
                style={{ flex: p.mode }}
              >
                <Panel config={p} editor={client} slot="bhs" />
              </div>
            ))}
          </div>
        )}
      </>
    );
  }

  render(container: Element) {
    // const ViewComponent = this.ui.ViewComponent.bind(this.ui);
    container.innerHTML = "";
    preactRender(h(this.ViewComponent.bind(this), {}), container);
  }
}

// TODO: Parking this here for now, this is very similar to the definition in top_bar.tsx

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

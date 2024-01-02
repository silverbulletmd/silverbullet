import { isMacLike, safeRun } from "../common/util.ts";
import { Confirm, Prompt } from "./components/basic_modals.tsx";
import { CommandPalette } from "./components/command_palette.tsx";
import { FilterList } from "./components/filter.tsx";
import { PageNavigator } from "./components/page_navigator.tsx";
import { TopBar } from "./components/top_bar.tsx";
import reducer from "./reducer.ts";
import { Action, AppViewState, initialViewState } from "./types.ts";
import {
  BookIcon,
  HomeIcon,
  preactRender,
  RefreshCwIcon,
  runScopeHandlers,
  TerminalIcon,
  useEffect,
  useReducer,
} from "./deps.ts";
import type { Client } from "./client.ts";
import { Panel } from "./components/panel.tsx";
import { h } from "./deps.ts";
import { sleep } from "$sb/lib/async.ts";

export class MainUI {
  viewState: AppViewState = initialViewState;
  viewDispatch: (action: Action) => void = () => {};

  constructor(private client: Client) {
    // Make keyboard shortcuts work even when the editor is in read only mode or not focused
    globalThis.addEventListener("keydown", (ev) => {
      if (!client.editorView.hasFocus) {
        if ((ev.target as any).closest(".cm-editor")) {
          // In some cm element, let's back out
          return;
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
        client.startPageNavigate();
      }
      // Launch the command palette using a three-finger tap
      if (ev.touches.length === 3) {
        ev.stopPropagation();
        ev.preventDefault();
        this.viewDispatch({
          type: "show-palette",
          context: client.getContext(),
        });
      }
    });
  }

  ViewComponent() {
    const [viewState, dispatch] = useReducer(reducer, initialViewState);
    this.viewState = viewState;
    this.viewDispatch = dispatch;

    const client = this.client;

    useEffect(() => {
      if (viewState.currentPage) {
        document.title = viewState.currentPage;
      }
    }, [viewState.currentPage]);

    useEffect(() => {
      client.tweakEditorDOM(
        client.editorView.contentDOM,
      );
    }, [viewState.uiOptions.forcedROMode]);

    useEffect(() => {
      this.client.rebuildEditorState();
      this.client.dispatchAppEvent("editor:modeswitch");
    }, [viewState.uiOptions.vimMode]);

    useEffect(() => {
      document.documentElement.dataset.theme = viewState.uiOptions.darkMode
        ? "dark"
        : "light";
    }, [viewState.uiOptions.darkMode]);

    useEffect(() => {
      // Need to dispatch a resize event so that the top_bar can pick it up
      globalThis.dispatchEvent(new Event("resize"));
    }, [viewState.panels]);

    return (
      <>
        {viewState.showPageNavigator && (
          <PageNavigator
            allPages={viewState.allPages}
            currentPage={client.currentPage}
            completer={client.miniEditorComplete.bind(client)}
            vimMode={viewState.uiOptions.vimMode}
            darkMode={viewState.uiOptions.darkMode}
            onNavigate={(page) => {
              dispatch({ type: "stop-navigate" });
              setTimeout(() => {
                client.focus();
              });
              if (page) {
                safeRun(async () => {
                  await client.navigate(page);
                });
              }
            }}
          />
        )}
        {viewState.showCommandPalette && (
          <CommandPalette
            onTrigger={(cmd) => {
              dispatch({ type: "hide-palette" });
              setTimeout(() => {
                client.focus();
              });
              if (cmd) {
                dispatch({ type: "command-run", command: cmd.command.name });
                cmd
                  .run()
                  .catch((e: any) => {
                    console.error("Error running command", e.message);
                  })
                  .then(() => {
                    // Always be focusing the editor after running a command
                    client.focus();
                  });
              }
            }}
            commands={client.getCommandsByContext(viewState)}
            vimMode={viewState.uiOptions.vimMode}
            darkMode={viewState.uiOptions.darkMode}
            completer={client.miniEditorComplete.bind(client)}
            recentCommands={viewState.recentCommands}
            settings={this.client.settings}
          />
        )}
        {viewState.showFilterBox && (
          <FilterList
            label={viewState.filterBoxLabel}
            placeholder={viewState.filterBoxPlaceHolder}
            options={viewState.filterBoxOptions}
            vimMode={viewState.uiOptions.vimMode}
            darkMode={viewState.uiOptions.darkMode}
            allowNew={false}
            completer={client.miniEditorComplete.bind(client)}
            helpText={viewState.filterBoxHelpText}
            onSelect={viewState.filterBoxOnSelect}
          />
        )}
        {viewState.showPrompt && (
          <Prompt
            message={viewState.promptMessage!}
            defaultValue={viewState.promptDefaultValue}
            vimMode={viewState.uiOptions.vimMode}
            darkMode={viewState.uiOptions.darkMode}
            completer={client.miniEditorComplete.bind(client)}
            callback={(value) => {
              dispatch({ type: "hide-prompt" });
              viewState.promptCallback!(value);
            }}
          />
        )}
        {viewState.showConfirm && (
          <Confirm
            message={viewState.confirmMessage!}
            callback={(value) => {
              dispatch({ type: "hide-confirm" });
              viewState.confirmCallback!(value);
            }}
          />
        )}
        <TopBar
          pageName={viewState.currentPage}
          notifications={viewState.notifications}
          syncFailures={viewState.syncFailures}
          unsavedChanges={viewState.unsavedChanges}
          isLoading={viewState.isLoading}
          vimMode={viewState.uiOptions.vimMode}
          darkMode={viewState.uiOptions.darkMode}
          progressPerc={viewState.progressPerc}
          completer={client.miniEditorComplete.bind(client)}
          onClick={() => {
            client.editorView.scrollDOM.scrollTop = 0;
          }}
          onRename={async (newName) => {
            if (!newName) {
              // Always move cursor to the start of the page
              client.editorView.dispatch({
                selection: { anchor: 0 },
              });
              client.focus();
              return;
            }
            console.log("Now renaming page to...", newName);
            await client.system.system.loadedPlugs.get("index")!.invoke(
              "renamePageCommand",
              [{ page: newName }],
            );
            client.focus();
          }}
          actionButtons={[
            ...!window.silverBulletConfig.syncOnly
              // If we support syncOnly, don't show this toggle button
              ? [{
                icon: RefreshCwIcon,
                description: this.client.syncMode
                  ? "Currently in Sync mode, click to switch to Online mode"
                  : "Currently in Online mode, click to switch to Sync mode",
                class: this.client.syncMode ? "sb-enabled" : undefined,
                callback: () => {
                  (async () => {
                    const newValue = !this.client.syncMode;

                    if (newValue) {
                      localStorage.setItem("syncMode", "true");
                      this.client.flashNotification(
                        "Now switching to sync mode, one moment please...",
                      );
                      await sleep(1000);
                      location.reload();
                    } else {
                      localStorage.removeItem("syncMode");
                      this.client.flashNotification(
                        "Now switching to online mode, one moment please...",
                      );
                      await sleep(1000);
                      location.reload();
                    }
                  })().catch(console.error);
                },
              }]
              : [],
            {
              icon: HomeIcon,
              description: `Go to the index page (Alt-h)`,
              callback: () => {
                client.navigate("", 0);
              },
              href: "",
            },
            {
              icon: BookIcon,
              description: `Open page (${isMacLike() ? "Cmd-k" : "Ctrl-k"})`,
              callback: () => {
                client.startPageNavigate();
              },
            },
            {
              icon: TerminalIcon,
              description: `Run command (${isMacLike() ? "Cmd-/" : "Ctrl-/"})`,
              callback: () => {
                dispatch({
                  type: "show-palette",
                  context: client.getContext(),
                });
              },
            },
          ]}
          rhs={!!viewState.panels.rhs.mode && (
            <div
              className="panel"
              style={{ flex: viewState.panels.rhs.mode }}
            />
          )}
          lhs={!!viewState.panels.lhs.mode && (
            <div
              className="panel"
              style={{ flex: viewState.panels.lhs.mode }}
            />
          )}
        />
        <div id="sb-main">
          {!!viewState.panels.lhs.mode && (
            <Panel config={viewState.panels.lhs} editor={client} />
          )}
          <div id="sb-editor" />
          {!!viewState.panels.rhs.mode && (
            <Panel config={viewState.panels.rhs} editor={client} />
          )}
        </div>
        {!!viewState.panels.modal.mode && (
          <div
            className="sb-modal"
            style={{ inset: `${viewState.panels.modal.mode}px` }}
          >
            <Panel config={viewState.panels.modal} editor={client} />
          </div>
        )}
        {!!viewState.panels.bhs.mode && (
          <div className="sb-bhs">
            <Panel config={viewState.panels.bhs} editor={client} />
          </div>
        )}
      </>
    );
  }

  render(container: Element) {
    // const ViewComponent = this.ui.ViewComponent.bind(this.ui);
    preactRender(h(this.ViewComponent.bind(this), {}), container);
  }
}

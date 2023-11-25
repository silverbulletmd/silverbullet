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
        this.viewDispatch({ type: "start-navigate" });
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

    const editor = this.client;

    useEffect(() => {
      if (viewState.currentPage) {
        document.title = viewState.currentPage;
      }
    }, [viewState.currentPage]);

    useEffect(() => {
      editor.tweakEditorDOM(
        editor.editorView.contentDOM,
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
            currentPage={editor.currentPage}
            completer={editor.miniEditorComplete.bind(editor)}
            vimMode={viewState.uiOptions.vimMode}
            darkMode={viewState.uiOptions.darkMode}
            onNavigate={(page) => {
              dispatch({ type: "stop-navigate" });
              setTimeout(() => {
                editor.focus();
              });
              if (page) {
                safeRun(async () => {
                  await editor.navigate(page);
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
                editor.focus();
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
                    editor.focus();
                  });
              }
            }}
            commands={editor.getCommandsByContext(viewState)}
            vimMode={viewState.uiOptions.vimMode}
            darkMode={viewState.uiOptions.darkMode}
            completer={editor.miniEditorComplete.bind(editor)}
            recentCommands={viewState.recentCommands}
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
            completer={editor.miniEditorComplete.bind(editor)}
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
            completer={editor.miniEditorComplete.bind(editor)}
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
          completer={editor.miniEditorComplete.bind(editor)}
          onClick={() => {
            editor.editorView.scrollDOM.scrollTop = 0;
          }}
          onRename={async (newName) => {
            if (!newName) {
              // Always move cursor to the start of the page
              editor.editorView.dispatch({
                selection: { anchor: 0 },
              });
              editor.focus();
              return;
            }
            console.log("Now renaming page to...", newName);
            await editor.system.system.loadedPlugs.get("index")!.invoke(
              "renamePageCommand",
              [{ page: newName }],
            );
            editor.focus();
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
              description: `Go home (Alt-h)`,
              callback: () => {
                editor.navigate("");
              },
              href: "",
            },
            {
              icon: BookIcon,
              description: `Open page (${isMacLike() ? "Cmd-k" : "Ctrl-k"})`,
              callback: () => {
                dispatch({ type: "start-navigate" });
                editor.space.updatePageList();
              },
            },
            {
              icon: TerminalIcon,
              description: `Run command (${isMacLike() ? "Cmd-/" : "Ctrl-/"})`,
              callback: () => {
                dispatch({
                  type: "show-palette",
                  context: editor.getContext(),
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
            <Panel config={viewState.panels.lhs} editor={editor} />
          )}
          <div id="sb-editor" />
          {!!viewState.panels.rhs.mode && (
            <Panel config={viewState.panels.rhs} editor={editor} />
          )}
        </div>
        {!!viewState.panels.modal.mode && (
          <div
            className="sb-modal"
            style={{ inset: `${viewState.panels.modal.mode}px` }}
          >
            <Panel config={viewState.panels.modal} editor={editor} />
          </div>
        )}
        {!!viewState.panels.bhs.mode && (
          <div className="sb-bhs">
            <Panel config={viewState.panels.bhs} editor={editor} />
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

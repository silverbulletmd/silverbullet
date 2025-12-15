import { Confirm, Prompt } from "./components/basic_modals.tsx";
import { CommandPalette } from "./components/command_palette.tsx";
import { FilterList } from "./components/filter.tsx";
import { AnythingPicker } from "./components/anything_picker.tsx";
import { TopBar } from "./components/top_bar.tsx";
import reducer from "./reducer.ts";
import {
  type Action,
  type AppViewState,
  initialViewState,
} from "./types/ui.ts";
import * as featherIcons from "preact-feather";
import * as mdi from "./filtered_material_icons.ts";
import { h, render as preactRender } from "preact";
import { useEffect, useReducer } from "preact/hooks";
import { closeSearchPanel } from "@codemirror/search";
import { runScopeHandlers } from "@codemirror/view";
import type { Client } from "./client.ts";
import { Panel } from "./components/panel.tsx";
import { safeRun } from "@silverbulletmd/silverbullet/lib/async";
import type { FilterOption } from "@silverbulletmd/silverbullet/type/client";
import {
  getNameFromPath,
  getPathExtension,
  isMarkdownPath,
  isValidName,
  parseToRef,
  type Path,
} from "@silverbulletmd/silverbullet/lib/ref";

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
          target.closest(".cm-content") || target.closest(".cm-vim-panel")
        ) {
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
        client.startPageNavigate("page");
      }
      // Launch the command palette using a three-finger tap
      if (ev.touches.length === 3) {
        ev.stopPropagation();
        ev.preventDefault();
        client.startCommandPalette();
      }
    });

    globalThis.addEventListener("mouseup", (_) => {
      setTimeout(() => {
        client.editorView.dispatch({});
      });
    });
  }

  viewDispatch: (action: Action) => void = () => {
  };

  ViewComponent() {
    const [viewState, dispatch] = useReducer(reducer, initialViewState);
    this.viewState = viewState;
    this.viewDispatch = dispatch;

    const client = this.client;

    useEffect(() => {
      if (viewState.current) {
        document.title = (viewState.current.meta.pageDecoration?.prefix ?? "") +
          getNameFromPath(viewState.current.path);
      }
    }, [viewState.current]);

    useEffect(() => {
      this.client.rebuildEditorState();
      this.client.dispatchAppEvent("editor:modeswitch");
    }, [viewState.uiOptions.vimMode]);

    useEffect(() => {
      const updateTheme = () => {
        const darkMode = viewState.uiOptions.darkMode === undefined
          ? globalThis.matchMedia("(prefers-color-scheme: dark)").matches
          : viewState.uiOptions.darkMode;

        document.documentElement.dataset.theme = darkMode ? "dark" : "light";

        if (this.client.isDocumentEditor()) {
          this.client.documentEditor.updateTheme();
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
      document.documentElement.dataset.markdownSyntaxRendering =
        viewState.uiOptions.markdownSyntaxRendering ? "on" : "off";
    }, [viewState.uiOptions.markdownSyntaxRendering]);

    useEffect(() => {
      // Need to dispatch a resize event so that the top_bar can pick it up
      globalThis.dispatchEvent(new Event("resize"));
    }, [viewState.panels]);
    const actionButtons = client.config.get<ActionButton[]>(
      "actionButtons",
      [],
    );
    return (
      <>
        {viewState.showPageNavigator && (
          <AnythingPicker
            allDocuments={viewState.allDocuments}
            allPages={viewState.allPages}
            extensions={new Set(
              Array.from(
                client.clientSystem.documentEditorHook.documentEditors.values(),
              ).flatMap(({ extensions }) => extensions),
            )}
            currentPath={client.currentPath()}
            mode={viewState.pageNavigatorMode}
            completer={client.miniEditorComplete.bind(client)}
            vimMode={viewState.uiOptions.vimMode}
            darkMode={viewState.uiOptions.darkMode}
            onModeSwitch={(mode) => {
              dispatch({ type: "stop-navigate" });
              setTimeout(() => {
                dispatch({ type: "start-navigate", mode });
              });
            }}
            onNavigate={(name) => {
              dispatch({ type: "stop-navigate" });
              setTimeout(() => {
                client.focus();
              });

              if (!name) {
                return;
              }

              safeRun(async () => {
                const ref = parseToRef(name);

                // Check beforhand, because we don't want to allow any link
                // stuff like #header here. The `!ref` check is just for
                // Typescript
                if (!isValidName(name) || !ref) {
                  // It's not a valid name so either, the user tried to create a
                  // page or we have an invalid file in the space. Names are
                  // only unique for files which follow our rules, so we are
                  // kind of in unknown territory now.

                  if (client.clientSystem.allKnownFiles.has(name)) {
                    // Try it as a document name === path
                    await this.promptDocumentOperation(
                      name as Path,
                      `'${name}' has an invalid name. You can now modify it`,
                    );
                  } else if (
                    client.clientSystem.allKnownFiles.has(`${name}.md`)
                  ) {
                    // Try it as a page
                    await this.promptDocumentOperation(
                      `${name}.md`,
                      `'${name}.md' has an invalid name. You can now modify it`,
                    );
                  } else {
                    client.flashNotification(
                      `Couldn't create page ${name}, name is invalid`,
                      "error",
                    );
                  }

                  return;
                }

                if (
                  !isMarkdownPath(ref.path) &&
                  !Array.from(
                    client.clientSystem.documentEditorHook.documentEditors
                      .values(),
                  ).some(({ extensions }) =>
                    extensions.includes(getPathExtension(ref.path))
                  )
                ) {
                  await this.promptDocumentOperation(
                    ref.path,
                    "This file cannot be edited, select your desired action.",
                  );
                } else {
                  client.navigate(ref);
                }
              });
            }}
          />
        )}
        {viewState.showCommandPalette && (
          <CommandPalette
            onTrigger={(cmd) => {
              safeRun(async () => {
                dispatch({ type: "hide-palette" });
                if (cmd) {
                  await this.client.registerCommandRun(cmd.name);
                  try {
                    const returnValue = await cmd.run!();
                    if (returnValue !== false) {
                      client.focus();
                    }
                  } catch (e: any) {
                    this.client.reportError(e, "Command invocation");
                  }
                } else {
                  setTimeout(() => client.focus());
                }
              });
            }}
            commands={client.getCommandsByContext(viewState)}
            vimMode={viewState.uiOptions.vimMode}
            darkMode={viewState.uiOptions.darkMode}
            completer={client.miniEditorComplete.bind(client)}
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
          pageName={!viewState.current
            ? ""
            : getNameFromPath(viewState.current.path)}
          notifications={viewState.notifications}
          isOnline={viewState.isOnline}
          unsavedChanges={viewState.unsavedChanges}
          isLoading={viewState.isLoading}
          vimMode={viewState.uiOptions.vimMode}
          darkMode={viewState.uiOptions.darkMode}
          progressPercentage={viewState.progressPercentage}
          progressType={viewState.progressType}
          completer={client.miniEditorComplete.bind(client)}
          onClick={() => {
            if (!client.isDocumentEditor()) {
              client.editorView.scrollDOM.scrollTop = 0;
            }
          }}
          onRename={async (newName) => {
            if (client.isDocumentEditor()) {
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
                client.config.get<string>("mobileMenuStyle", "hamburger")
                  .includes(
                    "hamburger",
                  ))
              ? [{
                icon: featherIcons.MoreVertical as any,
                description: "Open Menu",
                class: "expander",
                callback: () => {
                  /* nothing to do, menu opens on hover/mobile click */
                },
              }]
              : [],
            // Custom action buttons
            ...actionButtons.filter(( // Filter out buttons without icons (invalid) and mobile buttons when not in mobile mode
              button,
            ) =>
              button.icon && (
                (typeof button.mobile === "undefined") ||
                (button.mobile === viewState.isMobile)
              )
            )
              // Then ensure all buttons have a priority set (by default based on array index)
              .map((button, index) => ({
                ...button,
                priority: button.priority ?? actionButtons.length - index,
              }))
              .sort((a, b) => b.priority - a.priority)
              .map((button) => {
                const mdiIcon = (mdi as any)[kebabToCamel(button.icon)];
                let featherIcon =
                  (featherIcons as any)[kebabToCamel(button.icon)];
                if (!featherIcon) {
                  featherIcon = featherIcons.HelpCircle;
                }
                return {
                  icon: (mdiIcon ? mdiIcon : featherIcon) as any,
                  description: button.description || "",
                  callback: button.run || (() => {
                    client.flashNotification(
                      "actionButton did not specify a run() callback",
                      "error",
                    );
                  }),
                  href: "",
                };
              }),
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
          pageNamePrefix={viewState.current?.meta.pageDecoration?.prefix ?? ""}
          cssClass={viewState.current?.meta.pageDecoration?.cssClasses
            ? viewState.current?.meta.pageDecoration?.cssClasses
              .join(" ").replaceAll(/[^a-zA-Z0-9-_ ]/g, "")
            : ""}
          mobileMenuStyle={client.config.get<string>(
            "mobileMenuStyle",
            "hamburger",
          )}
        />
        <div id="sb-main">
          {(viewState.panels.lhs.mode !== undefined) && (
            <Panel config={viewState.panels.lhs} editor={client} />
          )}
          <div id="sb-editor" />
          {(viewState.panels.rhs.mode !== undefined) && (
            <Panel config={viewState.panels.rhs} editor={client} />
          )}
        </div>
        {(viewState.panels.modal.mode !== undefined) && (
          <div
            className="sb-modal"
            style={{ inset: `${viewState.panels.modal.mode}px` }}
          >
            <Panel config={viewState.panels.modal} editor={client} />
          </div>
        )}
        {(viewState.panels.bhs.mode !== undefined) && (
          <div className="sb-bhs">
            <Panel config={viewState.panels.bhs} editor={client} />
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

  async promptDocumentOperation(path: Path, msg: string) {
    const options: string[] = ["View", "Delete", "Rename"];

    const option = await client.filterBox(
      "Modify",
      options.map((x) => ({ name: x } as FilterOption)),
      msg,
    );
    if (!option) return;

    switch (option.name) {
      case "View": {
        await client.navigate({ path: path });
        break;
      }
      case "Delete": {
        if (
          await client.confirm(
            `Are you sure you would like delete ${getNameFromPath(path)}?`,
          )
        ) {
          if (isMarkdownPath(path)) {
            await client.space.deletePage(getNameFromPath(path));
          } else {
            await client.space.deleteDocument(getNameFromPath(path));
          }
        }
        break;
      }
      case "Rename": {
        if (isMarkdownPath(path)) {
          await client.clientSystem.system.invokeFunction(
            "index.renamePageCommand",
            [{ oldPage: getNameFromPath(path) }],
          );
        } else {
          await client.clientSystem.system.invokeFunction(
            "index.renameDocumentCommand",
            [{ oldDocument: getNameFromPath(path) }],
          );
        }
        break;
      }
    }
  }
}

// TODO: Parking this here for now, this is very similar to the definition in top_bar.tsx

type ActionButton = {
  icon: string;
  description?: string;
  mobile?: boolean;
  priority?: number;
  run: () => void;
};

function kebabToCamel(str: string) {
  return str.replace(/-([a-z])/g, (g) => g[1].toUpperCase()).replace(
    /^./,
    (g) => g.toUpperCase(),
  );
}

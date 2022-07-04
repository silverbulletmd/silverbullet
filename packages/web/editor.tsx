import {
  autocompletion,
  completionKeymap,
  CompletionResult,
} from "@codemirror/autocomplete";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { indentWithTab, standardKeymap } from "@codemirror/commands";
import { history, historyKeymap } from "@codemirror/commands";
import { syntaxHighlighting } from "@codemirror/language";
import { searchKeymap } from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  KeyBinding,
  keymap,
  runScopeHandlers,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import React, { useEffect, useReducer } from "react";
import ReactDOM from "react-dom";
import { createSandbox as createIFrameSandbox } from "@plugos/plugos/environments/webworker_sandbox";
import { AppEvent, ClickEvent } from "./app_event";
import { CommandPalette } from "./components/command_palette";
import { PageNavigator } from "./components/page_navigator";
import { TopBar } from "./components/top_bar";
import { lineWrapper } from "./line_wrapper";
import { markdown } from "@silverbulletmd/common/markdown";
import { PathPageNavigator } from "./navigator";
import buildMarkdown from "@silverbulletmd/common/parser";
import reducer from "./reducer";
import { smartQuoteKeymap } from "./smart_quotes";
import { Space } from "@silverbulletmd/common/spaces/space";
import customMarkdownStyle from "./style";
import { editorSyscalls } from "./syscalls/editor";
import { indexerSyscalls } from "./syscalls";
import { spaceSyscalls } from "./syscalls/space";
import { Action, AppViewState, initialViewState } from "./types";
import { SilverBulletHooks } from "@silverbulletmd/common/manifest";
import { safeRun, throttle } from "../common/util";
import { System } from "@plugos/plugos/system";
import { EventHook } from "@plugos/plugos/hooks/event";
import { systemSyscalls } from "./syscalls/system";
import { Panel } from "./components/panel";
import { CommandHook } from "./hooks/command";
import { SlashCommandHook } from "./hooks/slash_command";
import { pasteLinkExtension } from "./editor_paste";
import { markdownSyscalls } from "@silverbulletmd/common/syscalls/markdown";
import { clientStoreSyscalls } from "./syscalls/clientStore";
import { StatusBar } from "./components/status_bar";
import {
  loadMarkdownExtensions,
  MDExt,
} from "@silverbulletmd/common/markdown_ext";
import { FilterList } from "./components/filter";
import { FilterOption, PageMeta } from "@silverbulletmd/common/types";
import { syntaxTree } from "@codemirror/language";
import sandboxSyscalls from "@plugos/plugos/syscalls/sandbox";
import { eventSyscalls } from "@plugos/plugos/syscalls/event";

class PageState {
  constructor(
    readonly scrollTop: number,
    readonly selection: EditorSelection
  ) {}
}

const saveInterval = 1000;

// Monkey patching the languageDataAt, somehow the languageData facet is not set
// properly, no idea why
// TODO: Remove at some point
EditorState.prototype.languageDataAt = function (
  name: string,
  pos: number,
  side = -1
) {
  let values = [];
  // console.log("Getting language data");
  // @ts-ignore
  for (let provider of this.facet(EditorState.languageData)) {
    let providerResult = provider(this, pos, side);
    if (!providerResult) {
      // console.log("Empty provider result");
      continue;
    }
    for (let result of providerResult) {
      if (Object.prototype.hasOwnProperty.call(result, name))
        values.push(result[name]);
    }
  }
  return values;
};

export class Editor {
  readonly commandHook: CommandHook;
  readonly slashCommandHook: SlashCommandHook;
  openPages = new Map<string, PageState>();
  editorView?: EditorView;
  viewState: AppViewState;
  viewDispatch: React.Dispatch<Action>;
  space: Space;
  pageNavigator: PathPageNavigator;
  eventHook: EventHook;
  saveTimeout: any;
  debouncedUpdateEvent = throttle(() => {
    this.eventHook
      .dispatchEvent("editor:updated")
      .catch((e) => console.error("Error dispatching editor:updated event", e));
  }, 1000);
  private system = new System<SilverBulletHooks>("client");
  private mdExtensions: MDExt[] = [];

  constructor(space: Space, parent: Element) {
    this.space = space;
    this.viewState = initialViewState;
    this.viewDispatch = () => {};

    // Event hook
    this.eventHook = new EventHook();
    this.system.addHook(this.eventHook);

    // Command hook
    this.commandHook = new CommandHook();
    this.commandHook.on({
      commandsUpdated: (commandMap) => {
        this.viewDispatch({
          type: "update-commands",
          commands: commandMap,
        });
      },
    });
    this.system.addHook(this.commandHook);

    // Slash command hook
    this.slashCommandHook = new SlashCommandHook(this);
    this.system.addHook(this.slashCommandHook);

    this.render(parent);
    this.editorView = new EditorView({
      state: this.createEditorState("", ""),
      parent: document.getElementById("editor")!,
    });
    this.pageNavigator = new PathPageNavigator();

    this.system.registerSyscalls(
      [],
      eventSyscalls(this.eventHook),
      editorSyscalls(this),
      spaceSyscalls(this),
      indexerSyscalls(this.space),
      systemSyscalls(this),
      markdownSyscalls(buildMarkdown(this.mdExtensions)),
      clientStoreSyscalls(),
      sandboxSyscalls(this.system)
    );

    // Make keyboard shortcuts work even when the editor is in read only mode or not focused
    window.addEventListener("keydown", (ev) => {
      if (!this.editorView?.hasFocus) {
        console.log("Window-level keyboard event", ev);
        if (runScopeHandlers(this.editorView!, ev, "editor")) {
          ev.preventDefault();
        }
      }
    });

    window.addEventListener("touchstart", (ev) => {
      // Launch the command palette using a three-finger tap
      if (ev.touches.length > 2) {
        ev.stopPropagation();
        ev.preventDefault();
        this.viewDispatch({ type: "show-palette" });
      }
    });
  }

  get currentPage(): string | undefined {
    return this.viewState.currentPage;
  }

  async init() {
    this.focus();

    this.pageNavigator.subscribe(async (pageName, pos) => {
      console.log("Now navigating to", pageName);

      if (!this.editorView) {
        return;
      }

      await this.loadPage(pageName);
      if (pos) {
        this.editorView.dispatch({
          selection: { anchor: pos },
        });
      }
    });

    let globalModules: any = await (await fetch("/global.plug.json")).json();

    this.system.on({
      plugLoaded: (plug) => {
        safeRun(async () => {
          for (let [modName, code] of Object.entries(
            globalModules.dependencies
          )) {
            await plug.sandbox.loadDependency(modName, code as string);
          }
        });
      },
    });

    this.space.on({
      pageChanged: (meta) => {
        if (this.currentPage === meta.name) {
          console.log("Page changed on disk, reloading");
          this.flashNotification("Page changed on disk, reloading");
          this.reloadPage();
        }
      },
      pageListUpdated: (pages) => {
        this.viewDispatch({
          type: "pages-listed",
          pages: pages,
        });
      },
    });

    if (this.pageNavigator.getCurrentPage() === "") {
      await this.pageNavigator.navigate("index");
    }
    await this.reloadPlugs();
  }

  async save(immediate: boolean = false): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.viewState.unsavedChanges) {
        return resolve();
      }
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
      }
      this.saveTimeout = setTimeout(
        () => {
          if (this.currentPage) {
            console.log("Saving page", this.currentPage);
            this.space
              .writePage(
                this.currentPage,
                this.editorView!.state.sliceDoc(0),
                true
              )
              .then(() => {
                this.viewDispatch({ type: "page-saved" });
                resolve();
              })
              .catch(reject);
          } else {
            resolve();
          }
        },
        immediate ? 0 : saveInterval
      );
    });
  }

  flashNotification(message: string) {
    let id = Math.floor(Math.random() * 1000000);
    this.viewDispatch({
      type: "show-notification",
      notification: {
        id: id,
        message: message,
        date: new Date(),
      },
    });
    setTimeout(() => {
      this.viewDispatch({
        type: "dismiss-notification",
        id: id,
      });
    }, 2000);
  }

  filterBox(
    label: string,
    options: FilterOption[],
    helpText: string = "",
    placeHolder: string = ""
  ): Promise<FilterOption | undefined> {
    return new Promise((resolve) => {
      this.viewDispatch({
        type: "show-filterbox",
        label,
        options,
        placeHolder,
        helpText,
        onSelect: (option) => {
          this.viewDispatch({ type: "hide-filterbox" });
          this.focus();
          resolve(option);
        },
      });
    });
  }

  async dispatchAppEvent(name: AppEvent, data?: any): Promise<any[]> {
    return this.eventHook.dispatchEvent(name, data);
  }

  createEditorState(pageName: string, text: string): EditorState {
    let commandKeyBindings: KeyBinding[] = [];
    for (let def of this.commandHook.editorCommands.values()) {
      if (def.command.key) {
        commandKeyBindings.push({
          key: def.command.key,
          mac: def.command.mac,
          run: (): boolean => {
            if (def.command.contexts) {
              let context = this.getContext();
              if (!context || !def.command.contexts.includes(context)) {
                return false;
              }
            }
            Promise.resolve()
              .then(def.run)
              .catch((e: any) => {
                console.error(e);
                this.flashNotification(`Error running command: ${e.message}`);
              });
            return true;
          },
        });
      }
    }
    const editor = this;
    return EditorState.create({
      doc: text,
      extensions: [
        markdown({
          base: buildMarkdown(this.mdExtensions),
          addKeymap: true,
        }),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        syntaxHighlighting(customMarkdownStyle(this.mdExtensions)),
        autocompletion({
          override: [
            this.completer.bind(this),
            this.slashCommandHook.slashCommandCompleter.bind(
              this.slashCommandHook
            ),
          ],
        }),
        EditorView.lineWrapping,
        lineWrapper([
          { selector: "ATXHeading1", class: "line-h1" },
          { selector: "ATXHeading2", class: "line-h2" },
          { selector: "ATXHeading3", class: "line-h3" },
          { selector: "ListItem", class: "line-li", nesting: true },
          { selector: "Blockquote", class: "line-blockquote" },
          { selector: "Task", class: "line-task" },
          { selector: "CodeBlock", class: "line-code" },
          { selector: "FencedCode", class: "line-fenced-code" },
          { selector: "Comment", class: "line-comment" },
          { selector: "BulletList", class: "line-ul" },
          { selector: "OrderedList", class: "line-ol" },
          { selector: "TableHeader", class: "line-tbl-header" },
        ]),
        keymap.of([
          ...smartQuoteKeymap,
          ...closeBracketsKeymap,
          ...standardKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          indentWithTab,
          ...commandKeyBindings,
          {
            key: "Ctrl-k",
            mac: "Cmd-k",
            run: (): boolean => {
              this.viewDispatch({ type: "start-navigate" });
              this.space.updatePageList();
              return true;
            },
          },
          {
            key: "Ctrl-/",
            mac: "Cmd-/",
            run: (): boolean => {
              let context = this.getContext();
              this.viewDispatch({
                type: "show-palette",
                context,
              });
              return true;
            },
          },
          {
            key: "Ctrl-l",
            mac: "Cmd-l",
            run: (): boolean => {
              this.editorView?.dispatch({
                effects: [
                  EditorView.scrollIntoView(
                    this.editorView.state.selection.main.anchor,
                    {
                      y: "center",
                    }
                  ),
                ],
              });
              return true;
            },
          },
        ]),

        EditorView.domEventHandlers({
          click: (event: MouseEvent, view: EditorView) => {
            safeRun(async () => {
              let clickEvent: ClickEvent = {
                page: pageName,
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                pos: view.posAtCoords(event)!,
              };
              await this.dispatchAppEvent("page:click", clickEvent);
            });
          },
        }),
        ViewPlugin.fromClass(
          class {
            update(update: ViewUpdate): void {
              if (update.docChanged) {
                editor.viewDispatch({ type: "page-changed" });
                editor.debouncedUpdateEvent();
                editor.save().catch((e) => console.error("Error saving", e));
              }
            }
          }
        ),
        pasteLinkExtension,
        closeBrackets(),
      ],
    });
  }

  async reloadPlugs() {
    console.log("Loading plugs");
    await this.space.updatePageList();
    await this.system.unloadAll();
    console.log("(Re)loading plugs");
    for (let pageInfo of this.space.listPlugs()) {
      let { text } = await this.space.readPage(pageInfo.name);
      await this.system.load(JSON.parse(text), createIFrameSandbox);
    }
    this.rebuildEditorState();
  }

  rebuildEditorState() {
    const editorView = this.editorView;
    console.log("Rebuilding editor state");
    if (editorView && this.currentPage) {
      console.log("Getting all syntax extensions");
      this.mdExtensions = loadMarkdownExtensions(this.system);

      // And reload the syscalls to use the new syntax extensions
      this.system.registerSyscalls(
        [],
        markdownSyscalls(buildMarkdown(this.mdExtensions))
      );

      this.saveState();

      editorView.setState(
        this.createEditorState(this.currentPage, editorView.state.sliceDoc())
      );
      if (editorView.contentDOM) {
        this.tweakEditorDOM(
          editorView.contentDOM,
          this.viewState.perm === "ro"
        );
      }

      this.restoreState(this.currentPage);
    }
  }

  async completer(): Promise<CompletionResult | null> {
    let results = await this.dispatchAppEvent("page:complete");
    let actualResult = null;
    for (const result of results) {
      if (result) {
        if (actualResult) {
          console.error(
            "Got completion results from multiple sources, cannot deal with that"
          );
          return null;
        }
        actualResult = result;
      }
    }
    return actualResult;
  }

  reloadPage() {
    console.log("Reloading page");
    safeRun(async () => {
      clearTimeout(this.saveTimeout);
      await this.loadPage(this.currentPage!);
    });
  }

  focus() {
    this.editorView!.focus();
  }

  async navigate(name: string, pos?: number) {
    await this.pageNavigator.navigate(name, pos);
  }

  async loadPage(pageName: string) {
    const loadingDifferentPage = pageName !== this.currentPage;
    const editorView = this.editorView;
    if (!editorView) {
      return;
    }

    // Persist current page state and nicely close page
    if (this.currentPage) {
      this.saveState();
      this.space.unwatchPage(this.currentPage);
      await this.save(true);
    }

    // Fetch next page to open
    let doc;
    try {
      doc = await this.space.readPage(pageName);
    } catch (e: any) {
      // Not found, new page
      console.log("Creating new page", pageName);
      doc = {
        text: "",
        meta: { name: pageName, lastModified: 0, perm: "rw" } as PageMeta,
      };
    }

    let editorState = this.createEditorState(pageName, doc.text);
    editorView.setState(editorState);
    if (editorView.contentDOM) {
      this.tweakEditorDOM(editorView.contentDOM, doc.meta.perm === "ro");
    }
    this.restoreState(pageName);
    this.space.watchPage(pageName);

    this.viewDispatch({
      type: "page-loaded",
      meta: doc.meta,
    });

    if (loadingDifferentPage) {
      await this.eventHook.dispatchEvent("editor:pageLoaded", pageName);
    }
  }

  tweakEditorDOM(contentDOM: HTMLElement, readOnly: boolean) {
    contentDOM.spellcheck = true;
    contentDOM.setAttribute("autocorrect", "on");
    contentDOM.setAttribute("autocapitalize", "on");
    contentDOM.setAttribute("contenteditable", readOnly ? "false" : "true");
  }

  private restoreState(pageName: string) {
    let pageState = this.openPages.get(pageName);
    const editorView = this.editorView!;
    if (pageState) {
      // Restore state
      // console.log("Restoring selection state", pageState);
      editorView.dispatch({
        selection: pageState.selection,
      });
      editorView.scrollDOM.scrollTop = pageState!.scrollTop;
    }
    editorView.focus();
  }

  private saveState() {
    this.openPages.set(
      this.currentPage!,
      new PageState(
        this.editorView!.scrollDOM.scrollTop,
        this.editorView!.state.selection
      )
    );
  }

  ViewComponent(): React.ReactElement {
    const [viewState, dispatch] = useReducer(reducer, initialViewState);
    this.viewState = viewState;
    this.viewDispatch = dispatch;

    const editor = this;

    useEffect(() => {
      if (viewState.currentPage) {
        document.title = viewState.currentPage;
      }
    }, [viewState.currentPage]);

    return (
      <>
        {viewState.showPageNavigator && (
          <PageNavigator
            allPages={viewState.allPages}
            currentPage={this.currentPage}
            onNavigate={(page) => {
              dispatch({ type: "stop-navigate" });
              editor.focus();
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
              editor.focus();
              if (cmd) {
                dispatch({ type: "command-run", command: cmd.command.name });
                cmd
                  .run()
                  .catch((e) => {
                    console.error("Error running command", e.message);
                  })
                  .then(() => {
                    // Always be focusing the editor after running a command
                    editor.focus();
                  });
              }
            }}
            commands={viewState.commands}
            recentCommands={viewState.recentCommands}
          />
        )}
        {viewState.showFilterBox && (
          <FilterList
            label={viewState.filterBoxLabel}
            placeholder={viewState.filterBoxPlaceHolder}
            options={viewState.filterBoxOptions}
            allowNew={false}
            helpText={viewState.filterBoxHelpText}
            onSelect={viewState.filterBoxOnSelect}
          />
        )}
        <TopBar
          pageName={viewState.currentPage}
          notifications={viewState.notifications}
          unsavedChanges={viewState.unsavedChanges}
          onClick={() => {
            dispatch({ type: "start-navigate" });
          }}
          onHomeClick={() => {
            editor.navigate("index");
          }}
          onActionClick={() => {
            dispatch({ type: "show-palette" });
          }}
          rhs={
            !!viewState.showRHS && (
              <div className="panel" style={{ flex: viewState.showRHS }} />
            )
          }
          lhs={
            !!viewState.showLHS && (
              <div className="panel" style={{ flex: viewState.showLHS }} />
            )
          }
        />
        <div id="main">
          {!!viewState.showLHS && (
            <Panel
              html={viewState.lhsHTML}
              script={viewState.lhsScript}
              flex={viewState.showLHS}
              editor={editor}
            />
          )}
          <div id="editor" />
          {!!viewState.showRHS && (
            <Panel
              html={viewState.rhsHTML}
              script={viewState.rhsScript}
              flex={viewState.showRHS}
              editor={editor}
            />
          )}
        </div>
        {!!viewState.showBHS && (
          <div id="bhs">
            <Panel
              html={viewState.bhsHTML}
              script={viewState.bhsScript}
              flex={1}
              editor={editor}
            />
          </div>
        )}
        <StatusBar editorView={editor.editorView} />
      </>
    );
  }

  render(container: ReactDOM.Container) {
    const ViewComponent = this.ViewComponent.bind(this);
    ReactDOM.render(<ViewComponent />, container);
  }

  private getContext(): string | undefined {
    let state = this.editorView!.state;
    let selection = state.selection.main;
    if (selection.empty) {
      return syntaxTree(state).resolveInner(selection.from).name;
    }
    return;
  }
}

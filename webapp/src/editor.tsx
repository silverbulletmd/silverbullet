import {
  autocompletion,
  Completion,
  CompletionContext,
  completionKeymap,
  CompletionResult,
} from "@codemirror/autocomplete";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/closebrackets";
import { indentWithTab, standardKeymap } from "@codemirror/commands";
import { history, historyKeymap } from "@codemirror/history";
import { bracketMatching } from "@codemirror/matchbrackets";
import { searchKeymap } from "@codemirror/search";
import {
  EditorSelection,
  EditorState,
  StateField,
  Text,
  Transaction,
} from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  KeyBinding,
  keymap,
} from "@codemirror/view";
// import { debounce } from "lodash";
import React, { useEffect, useReducer } from "react";
import ReactDOM from "react-dom";
import { Plug, System } from "../../plugbox/src/runtime";
import { WebworkerSandbox } from "../../plugbox/src/worker_sandbox";
import { AppEvent, AppEventDispatcher, ClickEvent } from "./app_event";
import { collabExtension, CollabDocument } from "./collab";
import * as commands from "./commands";
import { CommandPalette } from "./components/command_palette";
import { PageNavigator } from "./components/page_navigator";
import { StatusBar } from "./components/status_bar";
import { TopBar } from "./components/top_bar";
import { Cursor } from "./cursorEffect";
import coreManifest from "./generated/core.plug.json";
import { Indexer } from "./indexer";
import { lineWrapper } from "./lineWrapper";
import { markdown } from "./markdown";
import { IPageNavigator, PathPageNavigator } from "./navigator";
import customMarkDown from "./parser";
import reducer from "./reducer";
import { smartQuoteKeymap } from "./smart_quotes";
import { RealtimeSpace } from "./space";
import customMarkdownStyle from "./style";
import dbSyscalls from "./syscalls/db.localstorage";
import editorSyscalls from "./syscalls/editor.browser";
import indexerSyscalls from "./syscalls/indexer.native";
import spaceSyscalls from "./syscalls/space.native";
import {
  Action,
  AppCommand,
  AppViewState,
  initialViewState,
  NuggetHook,
  slashCommandRegexp,
} from "./types";
import { safeRun, throttle } from "./util";

class PageState {
  scrollTop: number;
  selection: EditorSelection;

  constructor(scrollTop: number, selection: EditorSelection) {
    this.scrollTop = scrollTop;
    this.selection = selection;
  }
}

export class Editor implements AppEventDispatcher {
  editorView?: EditorView;
  viewState: AppViewState;
  viewDispatch: React.Dispatch<Action>;
  openPages: Map<string, PageState>;
  space: RealtimeSpace;
  editorCommands: Map<string, AppCommand>;
  plugs: Plug<NuggetHook>[];
  indexer: Indexer;
  navigationResolve?: (val: undefined) => void;
  pageNavigator: IPageNavigator;
  indexCurrentPageDebounced: () => any;

  constructor(space: RealtimeSpace, parent: Element) {
    this.editorCommands = new Map();
    this.openPages = new Map();
    this.plugs = [];
    this.space = space;
    this.viewState = initialViewState;
    this.viewDispatch = () => {};
    this.render(parent);
    this.editorView = new EditorView({
      state: this.createEditorState(
        "",
        new CollabDocument(Text.of([""]), 0, new Map<string, Cursor>())
      ),
      parent: document.getElementById("editor")!,
    });
    this.pageNavigator = new PathPageNavigator();
    this.indexer = new Indexer("page-index", space);

    this.indexCurrentPageDebounced = throttle(
      this.indexCurrentPage.bind(this),
      2000
    );
  }

  async init() {
    await this.loadPlugs();
    this.focus();

    this.pageNavigator.subscribe(async (pageName) => {
      console.log("Now navigating to", pageName);

      if (!this.editorView) {
        return;
      }

      await this.loadPage(pageName);
    });

    this.space.on({
      connect: () => {
        if (this.currentPage) {
          console.log("Connected to socket, fetch fresh?");
          this.flashNotification("Reconnected, reloading page");
          this.reloadPage();
        }
      },
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
      this.pageNavigator.navigate("start");
    }
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

  async loadPlugs() {
    const system = new System<NuggetHook>();
    system.registerSyscalls(
      dbSyscalls,
      editorSyscalls(this),
      spaceSyscalls(this),
      indexerSyscalls(this.indexer)
    );

    console.log("Now loading core plug");
    let mainPlug = await system.load(
      "core",
      coreManifest,
      new WebworkerSandbox(system)
    );
    this.plugs.push(mainPlug);
    this.editorCommands = new Map<string, AppCommand>();
    for (let plug of this.plugs) {
      this.buildCommands(plug);
    }
    this.viewDispatch({
      type: "update-commands",
      commands: this.editorCommands,
    });
  }

  private buildCommands(plug: Plug<NuggetHook>) {
    const cmds = plug.manifest!.hooks.commands;
    for (let name in cmds) {
      let cmd = cmds[name];
      this.editorCommands.set(name, {
        command: cmd,
        run: async (arg): Promise<any> => {
          return await plug.invoke(cmd.invoke, [arg]);
        },
      });
    }
  }

  // TODO: Parallelize?
  async dispatchAppEvent(name: AppEvent, data?: any): Promise<any[]> {
    let results: any[] = [];
    for (let plug of this.plugs) {
      let plugResults = await plug.dispatchEvent(name, data);
      if (plugResults) {
        for (let result of plugResults) {
          results.push(result);
        }
      }
    }
    return results;
  }

  get currentPage(): string | undefined {
    return this.viewState.currentPage;
  }

  createEditorState(pageName: string, doc: CollabDocument): EditorState {
    const editor = this;
    let commandKeyBindings: KeyBinding[] = [];
    for (let def of this.editorCommands.values()) {
      if (def.command.key) {
        commandKeyBindings.push({
          key: def.command.key,
          mac: def.command.mac,
          run: (): boolean => {
            Promise.resolve()
              .then(async () => {
                await def.run(null);
              })
              .catch((e) => console.error(e));
            return true;
          },
        });
      }
    }
    return EditorState.create({
      doc: doc.text,
      extensions: [
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        customMarkdownStyle,
        bracketMatching(),
        closeBrackets(),
        collabExtension(pageName, this.space.socket.id, doc, this.space, {
          pushUpdates: this.space.pushUpdates.bind(this.space),
          pullUpdates: this.space.pullUpdates.bind(this.space),
          reload: this.reloadPage.bind(this),
        }),
        autocompletion({
          override: [
            this.plugCompleter.bind(this),
            this.commandCompleter.bind(this),
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
            key: "Ctrl-b",
            mac: "Cmd-b",
            run: commands.insertMarker("**"),
          },
          {
            key: "Ctrl-i",
            mac: "Cmd-i",
            run: commands.insertMarker("_"),
          },
          {
            key: "Ctrl-p",
            mac: "Cmd-p",
            run: (): boolean => {
              window.open(location.href, "_blank")!.focus();
              return true;
            },
          },
          {
            key: "Ctrl-k",
            mac: "Cmd-k",
            run: (target): boolean => {
              this.viewDispatch({ type: "start-navigate" });
              return true;
            },
          },
          {
            key: "Ctrl-.",
            mac: "Cmd-.",
            run: (target): boolean => {
              console.log("YO");

              this.viewDispatch({
                type: "show-palette",
              });
              return true;
            },
          },
        ]),
        EditorView.domEventHandlers({
          click: (event: MouseEvent, view: EditorView) => {
            safeRun(async () => {
              let clickEvent: ClickEvent = {
                ctrlKey: event.ctrlKey,
                metaKey: event.metaKey,
                altKey: event.altKey,
                pos: view.posAtCoords(event)!,
              };
              await this.dispatchAppEvent("page:click", clickEvent);
            });
          },
        }),
        markdown({
          base: customMarkDown,
        }),
        StateField.define({
          create: () => null,
          update: this.update.bind(this),
        }),
      ],
    });
  }

  reloadPage() {
    console.log("Reloading page");
    this.loadPage(this.currentPage!);
  }

  async plugCompleter(
    ctx: CompletionContext
  ): Promise<CompletionResult | null> {
    let allCompletionResults = await this.dispatchAppEvent("editor:complete");
    if (allCompletionResults.length === 1) {
      return allCompletionResults[0];
    } else if (allCompletionResults.length > 1) {
      console.error(
        "Got completion results from multiple sources, cannot deal with that",
        allCompletionResults
      );
    }
    return null;
  }

  commandCompleter(ctx: CompletionContext): CompletionResult | null {
    let prefix = ctx.matchBefore(slashCommandRegexp);
    if (!prefix) {
      return null;
    }
    let options: Completion[] = [];
    for (let [name, def] of this.viewState.commands) {
      if (!def.command.slashCommand) {
        continue;
      }
      options.push({
        label: def.command.slashCommand,
        detail: name,
        apply: () => {
          this.editorView?.dispatch({
            changes: {
              from: prefix!.from,
              to: ctx.pos,
              insert: "",
            },
          });
          safeRun(async () => {
            def.run(null);
          });
        },
      });
    }
    return {
      from: prefix.from + 1,
      options: options,
    };
  }

  update(value: null, transaction: Transaction): null {
    if (transaction.docChanged) {
      this.indexCurrentPageDebounced();
    }

    return null;
  }

  private async indexCurrentPage() {
    if (this.currentPage) {
      console.log("Indexing page", this.currentPage);
      await this.indexer.indexPage(
        this,
        this.currentPage,
        this.editorView!.state.sliceDoc(),
        true
      );
    }
  }

  focus() {
    this.editorView!.focus();
  }

  navigate(name: string) {
    this.pageNavigator.navigate(name);
  }

  async loadPage(pageName: string) {
    const editorView = this.editorView;
    if (!editorView) {
      return;
    }

    // Persist current page state and nicely close page
    if (this.currentPage) {
      let pageState = this.openPages.get(this.currentPage)!;
      if (pageState) {
        pageState.selection = this.editorView!.state.selection;
        pageState.scrollTop = this.editorView!.scrollDOM.scrollTop;
      }

      this.space.closePage(this.currentPage);
    }

    // Fetch next page to open
    let doc = await this.space.openPage(pageName);
    let editorState = this.createEditorState(pageName, doc);
    let pageState = this.openPages.get(pageName);
    editorView.setState(editorState);
    if (!pageState) {
      pageState = new PageState(0, editorState.selection);
      this.openPages.set(pageName, pageState!);
      editorView.dispatch({
        selection: { anchor: 0 },
      });
    } else {
      // Restore state
      console.log("Restoring selection state", pageState.selection);
      editorView.dispatch({
        selection: pageState.selection,
      });
      editorView.scrollDOM.scrollTop = pageState!.scrollTop;
    }

    this.viewDispatch({
      type: "page-loaded",
      name: pageName,
    });

    // TODO: Check if indexing is required?
    await this.indexCurrentPage();
  }

  ViewComponent(): React.ReactElement {
    const [viewState, dispatch] = useReducer(reducer, initialViewState);
    this.viewState = viewState;
    this.viewDispatch = dispatch;

    let editor = this;

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
                  editor.navigate(page);
                });
              }
            }}
          />
        )}
        {viewState.showCommandPalette && (
          <CommandPalette
            onTrigger={(cmd) => {
              dispatch({ type: "hide-palette" });
              editor!.focus();
              if (cmd) {
                safeRun(async () => {
                  let result = await cmd.run(null);
                  console.log("Result of command", result);
                });
              }
            }}
            commands={viewState.commands}
          />
        )}
        <TopBar
          pageName={viewState.currentPage}
          notifications={viewState.notifications}
          onClick={() => {
            dispatch({ type: "start-navigate" });
          }}
        />
        <div id="editor"></div>
      </>
    );
  }

  render(container: ReactDOM.Container) {
    const ViewComponent = this.ViewComponent.bind(this);
    ReactDOM.render(<ViewComponent />, container);
  }
}

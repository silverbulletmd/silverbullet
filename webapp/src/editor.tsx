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
import { EditorState, StateField, Transaction } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  KeyBinding,
  keymap,
} from "@codemirror/view";

import React, { useEffect, useReducer } from "react";
import ReactDOM from "react-dom";
import coreManifest from "./generated/core.plug.json";

// @ts-ignore
window.coreManifest = coreManifest;
import { AppEvent, AppEventDispatcher, ClickEvent } from "./app_event";
import * as commands from "./commands";
import { CommandPalette } from "./components/command_palette";
import { PageNavigator } from "./components/page_navigator";
import { StatusBar } from "./components/status_bar";
import { TopBar } from "./components/top_bar";
import { Indexer } from "./indexer";
import { lineWrapper } from "./lineWrapper";
import { markdown } from "./markdown";
import { IPageNavigator, PathPageNavigator } from "./navigator";
import customMarkDown from "./parser";
import { BrowserSystem } from "./plugbox_browser/browser_system";
import { Plug } from "../../plugbox/src/runtime";
import { slashCommandRegexp } from "./types";

import reducer from "./reducer";
import { smartQuoteKeymap } from "./smart_quotes";
import { Space } from "./space";
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
  PageMeta,
} from "./types";
import { safeRun } from "./util";

class PageState {
  editorState: EditorState;
  scrollTop: number;
  meta: PageMeta;

  constructor(editorState: EditorState, scrollTop: number, meta: PageMeta) {
    this.editorState = editorState;
    this.scrollTop = scrollTop;
    this.meta = meta;
  }
}

const watchInterval = 5000;

export class Editor implements AppEventDispatcher {
  editorView?: EditorView;
  viewState: AppViewState;
  viewDispatch: React.Dispatch<Action>;
  openPages: Map<string, PageState>;
  space: Space;
  editorCommands: Map<string, AppCommand>;
  plugs: Plug<NuggetHook>[];
  indexer: Indexer;
  navigationResolve?: (val: undefined) => void;
  pageNavigator: IPageNavigator;

  constructor(space: Space, parent: Element) {
    this.editorCommands = new Map();
    this.openPages = new Map();
    this.plugs = [];
    this.space = space;
    this.viewState = initialViewState;
    this.viewDispatch = () => {};
    this.render(parent);
    this.editorView = new EditorView({
      state: this.createEditorState(""),
      parent: document.getElementById("editor")!,
    });
    this.pageNavigator = new PathPageNavigator();
    this.indexer = new Indexer("page-index", space);
    this.watch();
  }

  async init() {
    await this.loadPageList();
    await this.loadPlugs();
    this.focus();

    this.pageNavigator.subscribe(async (pageName) => {
      await this.save();
      console.log("Now navigating to", pageName);

      if (!this.editorView) {
        return;
      }

      await this.loadPage(pageName);
    });

    if (this.pageNavigator.getCurrentPage() === "") {
      this.pageNavigator.navigate("start");
    }
  }

  async loadPlugs() {
    const system = new BrowserSystem<NuggetHook>("/plug");
    system.registerSyscalls(
      dbSyscalls,
      editorSyscalls(this),
      spaceSyscalls(this),
      indexerSyscalls(this.indexer)
    );

    await system.bootServiceWorker();
    console.log("Now loading core plug");
    let mainPlug = await system.load("core", coreManifest);
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

  get currentPage(): PageMeta | undefined {
    return this.viewState.currentPage;
  }

  createEditorState(text: string): EditorState {
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
      doc: text,
      extensions: [
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        // indentOnInput(),
        customMarkdownStyle,
        bracketMatching(),
        closeBrackets(),
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
            key: "Ctrl-s",
            mac: "Cmd-s",
            run: (target): boolean => {
              this.save();
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
          // focus: (event: FocusEvent, view: EditorView) => {
          //   console.log("Got focus");
          //   document.body.classList.add("keyboard");
          // },
          // blur: (event: FocusEvent, view: EditorView) => {
          //   console.log("Lost focus");
          //   document.body.classList.remove("keyboard");
          // },
          // focusout: (event: FocusEvent, view: EditorView) => {
          //   window.scrollTo(0, 0);
          // },
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
      this.viewDispatch({
        type: "page-updated",
      });
    }

    return null;
  }

  async save() {
    const editorState = this.editorView!.state;

    if (!this.currentPage) {
      return;
    }

    if (this.viewState.isSaved) {
      console.log("Page not modified, skipping saving");
      return;
    }
    // Write to the space
    const pageName = this.currentPage.name;
    const text = editorState.sliceDoc();
    let pageMeta = await this.space.writePage(pageName, text);

    // Update in open page cache
    this.openPages.set(
      pageName,
      new PageState(editorState, this.editorView!.scrollDOM.scrollTop, pageMeta)
    );

    // Dispatch update to view
    this.viewDispatch({ type: "page-saved", meta: pageMeta });

    // If a new page was created, let's refresh the page list
    if (pageMeta.created) {
      await this.loadPageList();
    }

    // Reindex page
    await this.indexPage(text, pageMeta);
  }

  private async indexPage(text: string, pageMeta: PageMeta) {
    console.log("Indexing page", pageMeta.name);
    this.indexer.indexPage(this, pageMeta, text, true);
  }

  async loadPageList() {
    let pagesMeta = await this.space.listPages();
    this.viewDispatch({
      type: "pages-listed",
      pages: pagesMeta,
    });
  }

  watch() {
    setInterval(() => {
      safeRun(async () => {
        if (this.currentPage && this.viewState.isSaved) {
          await this.checkForNewVersion(this.currentPage);
        }
      });
    }, watchInterval);
  }

  async checkForNewVersion(cachedMeta: PageMeta) {
    const currentPageName = cachedMeta.name;
    let newPageMeta = await this.space.getPageMeta(currentPageName);
    if (
      cachedMeta.lastModified.getTime() !== newPageMeta.lastModified.getTime()
    ) {
      console.log("File changed on disk, reloading");
      let pageData = await this.space.readPage(currentPageName);
      this.openPages.set(
        currentPageName,
        new PageState(this.createEditorState(pageData.text), 0, newPageMeta)
      );
      await this.loadPage(currentPageName, false);
    }
  }

  focus() {
    this.editorView!.focus();
  }

  navigate(name: string) {
    this.pageNavigator.navigate(name);
  }

  async loadPage(pageName: string, checkNewVersion: boolean = true) {
    let pageState = this.openPages.get(pageName);
    if (!pageState) {
      let pageData = await this.space.readPage(pageName);
      pageState = new PageState(
        this.createEditorState(pageData.text),
        0,
        pageData.meta
      );
      this.openPages.set(pageName, pageState!);
      // Freshly loaded, no need to check for a new version either way
      checkNewVersion = false;
    }
    this.editorView!.setState(pageState!.editorState);
    this.editorView!.scrollDOM.scrollTop = pageState!.scrollTop;

    this.viewDispatch({
      type: "page-loaded",
      meta: pageState.meta,
    });

    let indexerPageMeta = await this.indexer.getPageIndexPageMeta(pageName);
    if (
      (indexerPageMeta &&
        pageState.meta.lastModified.getTime() !==
          indexerPageMeta.lastModified.getTime()) ||
      !indexerPageMeta
    ) {
      await this.indexPage(pageState.editorState.sliceDoc(), pageState.meta);
    }

    if (checkNewVersion) {
      // Loaded page from in-memory cache, let's async see if this page hasn't been updated
      this.checkForNewVersion(pageState.meta).catch((e) => {
        console.error("Failed to check for new version");
      });
    }
  }

  ViewComponent(): React.ReactElement {
    const [viewState, dispatch] = useReducer(reducer, initialViewState);
    this.viewState = viewState;
    this.viewDispatch = dispatch;

    // Auto save
    useEffect(() => {
      const id = setTimeout(() => {
        if (!viewState.isSaved) {
          this.save();
        }
      }, 2000);
      return () => {
        clearTimeout(id);
      };
    }, [viewState.isSaved]);

    let editor = this;

    useEffect(() => {
      if (viewState.currentPage) {
        document.title = viewState.currentPage.name;
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
          currentPage={viewState.currentPage}
          onClick={() => {
            dispatch({ type: "start-navigate" });
          }}
        />
        <div id="editor"></div>
        <StatusBar isSaved={viewState.isSaved} editorView={this.editorView} />
      </>
    );
  }

  render(container: ReactDOM.Container) {
    const ViewComponent = this.ViewComponent.bind(this);
    ReactDOM.render(<ViewComponent />, container);
  }
}

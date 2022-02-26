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
import { indentOnInput, syntaxTree } from "@codemirror/language";
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
import coreManifest from "../../plugins/dist/core.plugin.json";
import * as commands from "./commands";
import { CommandPalette } from "./components/command_palette";
import { NavigationBar } from "./components/navigation_bar";
import { PageNavigator } from "./components/page_navigator";
import { StatusBar } from "./components/status_bar";
import { Space } from "./space";
import { lineWrapper } from "./lineWrapper";
import { markdown } from "./markdown";
import customMarkDown from "./parser";
import { BrowserSystem } from "./plugins/browser_system";
import { Manifest, slashCommandRegexp } from "./plugins/types";
import reducer from "./reducer";
import customMarkdownStyle from "./style";
import dbSyscalls from "./syscalls/db.localstorage";
import { Plugin } from "./plugins/runtime";
import editorSyscalls from "./syscalls/editor.browser";
import spaceSyscalls from "./syscalls/space.native";
import {
  Action,
  AppCommand,
  AppViewState,
  initialViewState,
  PageMeta,
} from "./types";
import { AppEvent, ClickEvent } from "./app_event";
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

export class Editor {
  editorView?: EditorView;
  viewState: AppViewState;
  viewDispatch: React.Dispatch<Action>;
  $hashChange?: () => void;
  openPages: Map<string, PageState>;
  fs: Space;
  editorCommands: Map<string, AppCommand>;
  plugins: Plugin[];

  constructor(fs: Space, parent: Element) {
    this.editorCommands = new Map();
    this.openPages = new Map();
    this.plugins = [];
    this.fs = fs;
    this.viewState = initialViewState;
    this.viewDispatch = () => {};
    this.render(parent);
    this.editorView = new EditorView({
      state: this.createEditorState(""),
      parent: document.getElementById("editor")!,
    });
    this.addListeners();
    // this.watch();
  }

  async init() {
    await this.loadPageList();
    await this.loadPlugins();
    this.$hashChange!();
    this.focus();
    await this.dispatchAppEvent("app:ready");
  }

  async loadPlugins() {
    const system = new BrowserSystem("plugin");
    system.registerSyscalls(
      dbSyscalls,
      editorSyscalls(this),
      spaceSyscalls(this)
    );

    await system.bootServiceWorker();
    console.log("Now loading core plugin");
    let mainPlugin = await system.load("core", coreManifest);
    this.plugins.push(mainPlugin);
    this.editorCommands = new Map<string, AppCommand>();
    for (let plugin of this.plugins) {
      this.buildCommands(plugin);
    }
    this.viewDispatch({
      type: "update-commands",
      commands: this.editorCommands,
    });
  }

  private buildCommands(plugin: Plugin) {
    const cmds = plugin.manifest!.commands;
    for (let name in cmds) {
      let cmd = cmds[name];
      this.editorCommands.set(name, {
        command: cmd,
        run: async (arg): Promise<any> => {
          return await plugin.invoke(cmd.invoke, [arg]);
        },
      });
    }
  }

  // TODO: Parallelize?
  async dispatchAppEvent(name: AppEvent, data?: any) {
    for (let plugin of this.plugins) {
      await plugin.dispatchEvent(name, data);
    }
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
        indentOnInput(),
        customMarkdownStyle,
        bracketMatching(),
        closeBrackets(),
        autocompletion({
          override: [
            this.pageCompleter.bind(this),
            this.commandCompleter.bind(this),
          ],
        }),
        EditorView.lineWrapping,
        lineWrapper([
          { selector: "ATXHeading1", class: "line-h1" },
          { selector: "ATXHeading2", class: "line-h2" },
          { selector: "ListItem", class: "line-li" },
          { selector: "Blockquote", class: "line-blockquote" },
          { selector: "CodeBlock", class: "line-code" },
          { selector: "FencedCode", class: "line-fenced-code" },
        ]),
        keymap.of([
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
            key: "Ctrl-e",
            mac: "Cmd-e",
            run: (target): boolean => {
              this.viewDispatch({ type: "start-navigate" });
              return true;
            },
          },
          {
            key: "Ctrl-.",
            mac: "Cmd-.",
            run: (target): boolean => {
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

  pageCompleter(ctx: CompletionContext): CompletionResult | null {
    let prefix = ctx.matchBefore(/\[\[[\w\s]*/);
    if (!prefix) {
      return null;
    }
    return {
      from: prefix.from + 2,
      options: this.viewState.allPages.map((pageMeta) => ({
        label: pageMeta.name,
        type: "page",
      })),
    };
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

  click(event: MouseEvent, view: EditorView) {
    // if (event.metaKey || event.ctrlKey) {
    //   let coords = view.posAtCoords(event)!;
    //   let node = syntaxTree(view.state).resolveInner(coords);
    //   if (node && node.name === "WikiLinkPage") {
    //     let pageName = view.state.sliceDoc(node.from, node.to);
    //     this.navigate(pageName);
    //   }
    //   if (node && node.name === "TaskMarker") {
    //     let checkBoxText = view.state.sliceDoc(node.from, node.to);
    //     if (checkBoxText === "[x]" || checkBoxText === "[X]") {
    //       view.dispatch({
    //         changes: { from: node.from, to: node.to, insert: "[ ]" },
    //       });
    //     } else {
    //       view.dispatch({
    //         changes: { from: node.from, to: node.to, insert: "[x]" },
    //       });
    //     }
    //   }
    //   return false;
    // }
  }

  async save() {
    const editorState = this.editorView!.state;

    if (!this.currentPage) {
      return;
    }
    // Write to file system
    let pageMeta = await this.fs.writePage(
      this.currentPage.name,
      editorState.sliceDoc()
    );

    // Update in open page cache
    this.openPages.set(
      this.currentPage.name,
      new PageState(editorState, this.editorView!.scrollDOM.scrollTop, pageMeta)
    );

    // Dispatch update to view
    this.viewDispatch({ type: "page-saved", meta: pageMeta });

    // If a new page was created, let's refresh the page list
    if (pageMeta.created) {
      await this.loadPageList();
    }
  }

  async loadPageList() {
    let pagesMeta = await this.fs.listPages();
    this.viewDispatch({
      type: "pages-listed",
      pages: pagesMeta,
    });
  }

  watch() {
    setInterval(() => {
      safeRun(async () => {
        if (!this.currentPage) {
          return;
        }
        const currentPageName = this.currentPage.name;
        let newPageMeta = await this.fs.getPageMeta(currentPageName);
        if (
          this.currentPage.lastModified.getTime() <
          newPageMeta.lastModified.getTime()
        ) {
          console.log("File changed on disk, reloading");
          let pageData = await this.fs.readPage(currentPageName);
          this.openPages.set(
            newPageMeta.name,
            new PageState(this.createEditorState(pageData.text), 0, newPageMeta)
          );
          await this.loadPage(currentPageName);
        }
      });
    }, watchInterval);
  }

  focus() {
    this.editorView!.focus();
  }

  async navigate(name: string) {
    location.hash = encodeURIComponent(name);
  }

  hashChange() {
    Promise.resolve()
      .then(async () => {
        await this.save();
        const pageName = decodeURIComponent(location.hash.substring(1));
        console.log("Now navigating to", pageName);

        if (!this.editorView) {
          return;
        }

        await this.loadPage(pageName);
      })
      .catch((e) => {
        console.error(e);
      });
  }

  async loadPage(pageName: string) {
    let pageState = this.openPages.get(pageName);
    if (!pageState) {
      let pageData = await this.fs.readPage(pageName);
      pageState = new PageState(
        this.createEditorState(pageData.text),
        0,
        pageData.meta
      );
      this.openPages.set(pageName, pageState!);
    }
    this.editorView!.setState(pageState!.editorState);
    this.editorView!.scrollDOM.scrollTop = pageState!.scrollTop;

    this.viewDispatch({
      type: "page-loaded",
      meta: pageState.meta,
    });
  }

  addListeners() {
    this.$hashChange = this.hashChange.bind(this);
    window.addEventListener("hashchange", this.$hashChange);
  }

  dispose() {
    if (this.$hashChange) {
      window.removeEventListener("hashchange", this.$hashChange);
    }
  }

  ViewComponent(): React.ReactElement {
    const [viewState, dispatch] = useReducer(reducer, initialViewState);
    this.viewState = viewState;
    this.viewDispatch = dispatch;

    useEffect(() => {
      if (!location.hash) {
        this.navigate("start");
      }
    }, []);

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
            onNavigate={(page) => {
              dispatch({ type: "stop-navigate" });
              editor!.focus();
              if (page) {
                editor
                  ?.save()
                  .then(() => {
                    editor!.navigate(page);
                  })
                  .catch((e) => {
                    alert("Could not save page, not switching");
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
        <NavigationBar
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

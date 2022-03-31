import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/closebrackets";
import { indentWithTab, standardKeymap } from "@codemirror/commands";
import { history, historyKeymap } from "@codemirror/history";
import { bracketMatching } from "@codemirror/matchbrackets";
import { searchKeymap } from "@codemirror/search";
import { EditorSelection, EditorState } from "@codemirror/state";
import {
  drawSelection,
  dropCursor,
  EditorView,
  highlightSpecialChars,
  KeyBinding,
  keymap,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";
import React, { useEffect, useReducer } from "react";
import ReactDOM from "react-dom";
import { createSandbox as createIFrameSandbox } from "../plugos/environments/iframe_sandbox";
import { AppEvent, AppEventDispatcher, ClickEvent } from "./app_event";
import * as commands from "./commands";
import { CommandPalette } from "./components/command_palette";
import { PageNavigator } from "./components/page_navigator";
import { TopBar } from "./components/top_bar";
import { lineWrapper } from "./line_wrapper";
import { markdown } from "./markdown";
import { PathPageNavigator } from "./navigator";
import customMarkDown from "./parser";
import reducer from "./reducer";
import { smartQuoteKeymap } from "./smart_quotes";
import { Space } from "./space";
import customMarkdownStyle from "./style";
import editorSyscalls from "./syscalls/editor";
import indexerSyscalls from "./syscalls/indexer";
import spaceSyscalls from "./syscalls/space";
import { Action, AppViewState, initialViewState } from "./types";
import { SilverBulletHooks } from "../common/manifest";
import { safeRun, throttle } from "./util";
import { System } from "../plugos/system";
import { EventHook } from "../plugos/hooks/event";
import { systemSyscalls } from "./syscalls/system";
import { Panel } from "./components/panel";
import { CommandHook } from "./hooks/command";
import { SlashCommandHook } from "./hooks/slash_command";
import { CompleterHook } from "./hooks/completer";
import { pasteLinkExtension } from "./editor_paste";

class PageState {
  scrollTop: number;
  selection: EditorSelection;

  constructor(scrollTop: number, selection: EditorSelection) {
    this.scrollTop = scrollTop;
    this.selection = selection;
  }
}

const saveInterval = 2000;

export class Editor implements AppEventDispatcher {
  private system = new System<SilverBulletHooks>("client");
  readonly commandHook: CommandHook;
  readonly slashCommandHook: SlashCommandHook;
  readonly completerHook: CompleterHook;

  openPages = new Map<string, PageState>();
  editorView?: EditorView;
  viewState: AppViewState;
  viewDispatch: React.Dispatch<Action>;
  space: Space;
  pageNavigator: PathPageNavigator;
  eventHook: EventHook;

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

    // Completer hook
    this.completerHook = new CompleterHook();
    this.system.addHook(this.completerHook);

    this.render(parent);
    this.editorView = new EditorView({
      state: this.createEditorState("", ""),
      parent: document.getElementById("editor")!,
    });
    this.pageNavigator = new PathPageNavigator();

    this.system.registerSyscalls("editor", [], editorSyscalls(this));
    this.system.registerSyscalls("space", [], spaceSyscalls(this));
    this.system.registerSyscalls("index", [], indexerSyscalls(this.space));
    this.system.registerSyscalls("system", [], systemSyscalls(this.space));
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

    let throttledRebuildEditorState = throttle(() => {
      this.rebuildEditorState();
    }, 100);

    this.space.on({
      pageCreated: (meta) => {
        console.log("Page created", meta);
      },
      pageDeleted: (meta) => {
        console.log("Page delete", meta);
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
      plugLoaded: (plugName, plug) => {
        safeRun(async () => {
          console.log("Plug load", plugName);
          await this.system.load(plugName, plug, createIFrameSandbox);
          throttledRebuildEditorState();
        });
      },
      plugUnloaded: (plugName) => {
        safeRun(async () => {
          console.log("Plug unload", plugName);
          await this.system.unload(plugName);
          throttledRebuildEditorState();
        });
      },
    });

    if (this.pageNavigator.getCurrentPage() === "") {
      await this.pageNavigator.navigate("start");
    }
  }

  saveTimeout: any;

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

  async dispatchAppEvent(name: AppEvent, data?: any): Promise<void> {
    return this.eventHook.dispatchEvent(name, data);
  }

  get currentPage(): string | undefined {
    return this.viewState.currentPage;
  }

  createEditorState(pageName: string, text: string): EditorState {
    let commandKeyBindings: KeyBinding[] = [];
    for (let def of this.commandHook.editorCommands.values()) {
      if (def.command.key) {
        commandKeyBindings.push({
          key: def.command.key,
          mac: def.command.mac,
          run: (): boolean => {
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
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        customMarkdownStyle,
        bracketMatching(),
        closeBrackets(),
        autocompletion({
          override: [
            this.completerHook.plugCompleter.bind(this.completerHook),
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
            run: (): boolean => {
              this.viewDispatch({ type: "start-navigate" });
              // asynchornously will dispatch pageListUpdate event
              this.space.updatePageListAsync();
              return true;
            },
          },
          {
            key: "Ctrl-.",
            mac: "Cmd-.",
            run: (): boolean => {
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
                editor.save();
              }
            }
          }
        ),
        pasteLinkExtension,
        markdown({
          base: customMarkDown,
        }),
      ],
    });
  }

  rebuildEditorState() {
    const editorView = this.editorView;
    if (editorView && this.currentPage) {
      editorView.setState(
        this.createEditorState(this.currentPage, editorView.state.sliceDoc())
      );
    }
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
      this.space.unwatchPage(this.currentPage);
      await this.save(true);
    }

    // Fetch next page to open
    let doc = await this.space.readPage(pageName);
    let editorState = this.createEditorState(pageName, doc.text);
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

    this.space.watchPage(pageName);

    this.viewDispatch({
      type: "page-loaded",
      name: pageName,
    });
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
      <div className={viewState.showRHS ? "rhs-open" : ""}>
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
              editor!.focus();
              if (cmd) {
                cmd.run().catch((e) => {
                  console.error("Error running command", e);
                });
              }
            }}
            commands={viewState.commands}
          />
        )}
        {viewState.showRHS && <Panel html={viewState.rhsHTML} />}
        <TopBar
          pageName={viewState.currentPage}
          notifications={viewState.notifications}
          unsavedChanges={viewState.unsavedChanges}
          onClick={() => {
            dispatch({ type: "start-navigate" });
          }}
        />
        <div id="editor" />
      </div>
    );
  }

  render(container: ReactDOM.Container) {
    const ViewComponent = this.ViewComponent.bind(this);
    ReactDOM.render(<ViewComponent />, container);
  }
}

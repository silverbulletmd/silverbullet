import ReactDOM from "https://esm.sh/react-dom@17";
import React, { useEffect, useReducer } from "https://esm.sh/react@17";

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
  CompletionResult,
  drawSelection,
  dropCursor,
  EditorSelection,
  EditorState,
  EditorView,
  highlightSpecialChars,
  history,
  historyKeymap,
  indentOnInput,
  indentWithTab,
  javascriptLanguage,
  KeyBinding,
  keymap,
  LanguageDescription,
  LanguageSupport,
  runScopeHandlers,
  searchKeymap,
  standardKeymap,
  StreamLanguage,
  syntaxHighlighting,
  syntaxTree,
  typescriptLanguage,
  ViewPlugin,
  ViewUpdate,
  yamlLanguage,
} from "../common/deps.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
// import { markdown } from "../common/_markdown/index.ts";
import { markdown } from "../common/deps.ts";

import { loadMarkdownExtensions, MDExt } from "../common/markdown_ext.ts";
import buildMarkdown from "../common/parser.ts";
import { Space } from "../common/spaces/space.ts";
import { markdownSyscalls } from "../common/syscalls/markdown.ts";
import { FilterOption, PageMeta } from "../common/types.ts";
import { safeRun, throttle } from "../common/util.ts";
import { createSandbox as createIFrameSandbox } from "../plugos/environments/webworker_sandbox.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import { eventSyscalls } from "../plugos/syscalls/event.ts";
import sandboxSyscalls from "../plugos/syscalls/sandbox.ts";
import { System } from "../plugos/system.ts";

import { AppEvent, ClickEvent } from "./app_event.ts";
import { CommandPalette } from "./components/command_palette.tsx";
import { FilterList } from "./components/filter.tsx";
import { PageNavigator } from "./components/page_navigator.tsx";
import { Panel } from "./components/panel.tsx";
import { TopBar } from "./components/top_bar.tsx";
import { attachmentExtension, pasteLinkExtension } from "./editor_paste.ts";
import { CommandHook } from "./hooks/command.ts";
import { SlashCommandHook } from "./hooks/slash_command.ts";
import { inlineImagesPlugin } from "./inline_image.ts";
import { lineWrapper } from "./line_wrapper.ts";
import { PathPageNavigator } from "./navigator.ts";
import reducer from "./reducer.ts";
import { smartQuoteKeymap } from "./smart_quotes.ts";
import customMarkdownStyle from "./style.ts";
import { clientStoreSyscalls } from "./syscalls/clientStore.ts";
import { editorSyscalls } from "./syscalls/editor.ts";
import { fulltextSyscalls } from "./syscalls/fulltext.ts";
import { indexerSyscalls } from "./syscalls/index.ts";
import { spaceSyscalls } from "./syscalls/space.ts";
import { storeSyscalls } from "./syscalls/store.ts";
import { systemSyscalls } from "./syscalls/system.ts";
import { Action, AppViewState, initialViewState } from "./types.ts";

class PageState {
  constructor(
    readonly scrollTop: number,
    readonly selection: EditorSelection,
  ) {}
}

const saveInterval = 1000;

// Monkey patching the languageDataAt, somehow the languageData facet is not set
// properly, no idea why

// TODO: Remove at some point
// EditorState.prototype.languageDataAt = function (
//   name: string,
//   pos: number,
//   side = -1,
// ) {
//   let values = [];
//   // console.log("Getting language data");
//   // @ts-ignore
//   for (let provider of this.facet(EditorState.languageData)) {
//     let providerResult = provider(this, pos, side);
//     if (!providerResult) {
//       // console.log("Empty provider result");
//       continue;
//     }
//     for (let result of providerResult) {
//       if (Object.prototype.hasOwnProperty.call(result, name)) {
//         values.push(result[name]);
//       }
//     }
//   }
//   return values;
// };

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
  urlPrefix: string;
  indexPage: string;

  constructor(
    space: Space,
    parent: Element,
    urlPrefix: string,
    indexPage: string,
  ) {
    this.space = space;
    this.urlPrefix = urlPrefix;
    this.viewState = initialViewState;
    this.viewDispatch = () => {};
    this.indexPage = indexPage;

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
      parent: document.getElementById("sb-editor")!,
    });
    this.pageNavigator = new PathPageNavigator(indexPage, urlPrefix);

    this.system.registerSyscalls(
      [],
      eventSyscalls(this.eventHook),
      editorSyscalls(this),
      spaceSyscalls(this),
      indexerSyscalls(this.space),
      fulltextSyscalls(this.space),
      systemSyscalls(this),
      markdownSyscalls(buildMarkdown(this.mdExtensions)),
      clientStoreSyscalls(),
      storeSyscalls(this.space),
      sandboxSyscalls(this.system),
    );

    // Make keyboard shortcuts work even when the editor is in read only mode or not focused
    window.addEventListener("keydown", (ev) => {
      if (!this.editorView?.hasFocus) {
        // console.log(
        //   "Window-level keyboard event",
        //   ev
        // );
        if ((ev.target as any).classList.contains("cm-textfield")) {
          // Search & replace feature, ignore this
          return;
        }
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

    this.pageNavigator.subscribe(async (pageName, pos: number | string) => {
      console.log("Now navigating to", pageName);

      if (!this.editorView) {
        return;
      }

      let stateRestored = await this.loadPage(pageName);
      if (pos) {
        if (typeof pos === "string") {
          // console.log("Navigating to anchor", pos);

          // We're going to look up the anchor through a direct page store query...
          let posLookup = await this.system.localSyscall("core", "index.get", [
            pageName,
            `a:${pageName}:@${pos}`,
          ]);

          if (!posLookup) {
            return this.flashNotification(
              `Could not find anchor @${pos}`,
              "error",
            );
          } else {
            pos = +posLookup;
          }
        }
        this.editorView.dispatch({
          selection: { anchor: pos },
          scrollIntoView: true,
        });
      } else if (!stateRestored) {
        this.editorView.dispatch({
          selection: { anchor: 0 },
          scrollIntoView: true,
        });
      }
    });

    let globalModules: any = await (
      await fetch(`${this.urlPrefix}/global.plug.json`)
    ).json();

    this.system.on({
      plugLoaded: async (plug) => {
        for (
          let [modName, code] of Object.entries(
            globalModules.dependencies,
          )
        ) {
          await plug.sandbox.loadDependency(modName, code as string);
        }
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

    await this.reloadPlugs();
    await this.dispatchAppEvent("editor:init");
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
                true,
              )
              .then(() => {
                this.viewDispatch({ type: "page-saved" });
                resolve();
              })
              .catch((e) => {
                this.flashNotification(
                  "Could not save page, retrying again in 10 seconds",
                  "error",
                );
                this.saveTimeout = setTimeout(this.save.bind(this), 10000);
                reject(e);
              });
          } else {
            resolve();
          }
        },
        immediate ? 0 : saveInterval,
      );
    });
  }

  flashNotification(message: string, type: "info" | "error" = "info") {
    let id = Math.floor(Math.random() * 1000000);
    this.viewDispatch({
      type: "show-notification",
      notification: {
        id,
        type,
        message,
        date: new Date(),
      },
    });
    setTimeout(
      () => {
        this.viewDispatch({
          type: "dismiss-notification",
          id: id,
        });
      },
      type === "info" ? 2000 : 5000,
    );
  }

  filterBox(
    label: string,
    options: FilterOption[],
    helpText: string = "",
    placeHolder: string = "",
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
                this.flashNotification(
                  `Error running command: ${e.message}`,
                  "error",
                );
              })
              .then(() => {
                // Always be focusing the editor after running a command
                editor.focus();
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
          codeLanguages: [
            LanguageDescription.of({
              name: "yaml",
              alias: ["meta", "data"],
              support: new LanguageSupport(StreamLanguage.define(yamlLanguage)),
            }),
            LanguageDescription.of({
              name: "javascript",
              alias: ["js"],
              support: new LanguageSupport(javascriptLanguage),
            }),
            LanguageDescription.of({
              name: "typescript",
              alias: ["ts"],
              support: new LanguageSupport(typescriptLanguage),
            }),
          ],
          addKeymap: true,
        }),
        syntaxHighlighting(customMarkdownStyle(this.mdExtensions)),
        autocompletion({
          override: [
            this.completer.bind(this),
            this.slashCommandHook.slashCommandCompleter.bind(
              this.slashCommandHook,
            ),
          ],
        }),
        inlineImagesPlugin(),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        EditorView.lineWrapping,
        lineWrapper([
          { selector: "ATXHeading1", class: "sb-line-h1" },
          { selector: "ATXHeading2", class: "sb-line-h2" },
          { selector: "ATXHeading3", class: "sb-line-h3" },
          { selector: "ListItem", class: "sb-line-li", nesting: true },
          { selector: "Blockquote", class: "sb-line-blockquote" },
          { selector: "Task", class: "sb-line-task" },
          { selector: "CodeBlock", class: "sb-line-code" },
          { selector: "FencedCode", class: "sb-line-fenced-code" },
          { selector: "Comment", class: "sb-line-comment" },
          { selector: "BulletList", class: "sb-line-ul" },
          { selector: "OrderedList", class: "sb-line-ol" },
          { selector: "TableHeader", class: "sb-line-tbl-header" },
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
                    },
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
          },
        ),
        pasteLinkExtension,
        attachmentExtension(this),
        closeBrackets(),
      ],
    });
  }

  async reloadPlugs() {
    console.log("Loading plugs");
    await this.space.updatePageList();
    await this.system.unloadAll();
    console.log("(Re)loading plugs");
    for (let plugName of await this.space.listPlugs()) {
      // console.log("Loading plug", pageInfo.name);
      let { data } = await this.space.readAttachment(plugName, "string");
      await this.system.load(JSON.parse(data as string), createIFrameSandbox);
    }
    this.rebuildEditorState();
    await this.dispatchAppEvent("plugs:loaded");
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
        markdownSyscalls(buildMarkdown(this.mdExtensions)),
      );

      this.saveState(this.currentPage);

      editorView.setState(
        this.createEditorState(this.currentPage, editorView.state.sliceDoc()),
      );
      if (editorView.contentDOM) {
        this.tweakEditorDOM(
          editorView.contentDOM,
          this.viewState.perm === "ro",
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
            "Got completion results from multiple sources, cannot deal with that",
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

  async navigate(name: string, pos?: number | string, replaceState = false) {
    if (!name) {
      name = this.indexPage;
    }
    await this.pageNavigator.navigate(name, pos, replaceState);
  }

  async loadPage(pageName: string): Promise<boolean> {
    const loadingDifferentPage = pageName !== this.currentPage;
    const editorView = this.editorView;
    if (!editorView) {
      return false;
    }

    const previousPage = this.currentPage;

    // Persist current page state and nicely close page
    if (previousPage) {
      this.saveState(previousPage);
      this.space.unwatchPage(previousPage);
      await this.save(true);
    }

    this.viewDispatch({
      type: "page-loading",
      name: pageName,
    });

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
    let stateRestored = this.restoreState(pageName);
    this.space.watchPage(pageName);

    this.viewDispatch({
      type: "page-loaded",
      meta: doc.meta,
    });

    if (loadingDifferentPage) {
      await this.eventHook.dispatchEvent("editor:pageLoaded", pageName);
    } else {
      await this.eventHook.dispatchEvent("editor:pageReloaded", pageName);
    }

    return stateRestored;
  }

  tweakEditorDOM(contentDOM: HTMLElement, readOnly: boolean) {
    contentDOM.spellcheck = true;
    contentDOM.setAttribute("autocorrect", "on");
    contentDOM.setAttribute("autocapitalize", "on");
    contentDOM.setAttribute(
      "contenteditable",
      readOnly || this.viewState.forcedROMode ? "false" : "true",
    );

    if (isMobileSafari() && readOnly) {
      console.log("Safari read only hack");
      contentDOM.classList.add("ios-safari-readonly");
    } else {
      contentDOM.classList.remove("ios-safari-readonly");
    }

    function isMobileSafari() {
      return (
        navigator.userAgent.match(/(iPod|iPhone|iPad)/) &&
        navigator.userAgent.match(/AppleWebKit/)
      );
    }
  }

  private restoreState(pageName: string): boolean {
    let pageState = this.openPages.get(pageName);
    const editorView = this.editorView!;
    if (pageState) {
      // Restore state
      // console.log("Restoring selection state", pageState);
      editorView.scrollDOM.scrollTop = pageState!.scrollTop;
      editorView.dispatch({
        selection: pageState.selection,
        scrollIntoView: true,
      });
    } else {
      editorView.scrollDOM.scrollTop = 0;
      editorView.dispatch({
        selection: { anchor: 0 },
        scrollIntoView: true,
      });
    }
    editorView.focus();
    return !!pageState;
  }

  private saveState(currentPage: string) {
    this.openPages.set(
      currentPage,
      new PageState(
        this.editorView!.scrollDOM.scrollTop,
        this.editorView!.state.selection,
      ),
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

    useEffect(() => {
      if (editor.editorView) {
        editor.tweakEditorDOM(
          editor.editorView.contentDOM,
          viewState.perm === "ro",
        );
      }
    }, [viewState.forcedROMode]);

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
                  .catch((e: any) => {
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
          isLoading={viewState.isLoading}
          onClick={() => {
            dispatch({ type: "start-navigate" });
          }}
          onThemeClick={() => {
            if (localStorage.theme === "dark") localStorage.theme = "light";
            else localStorage.theme = "dark";
            document.documentElement.dataset.theme = localStorage.theme;
          }}
          onHomeClick={() => {
            editor.navigate("");
          }}
          onActionClick={() => {
            dispatch({ type: "show-palette" });
          }}
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

  async runCommandByName(name: string) {
    const cmd = this.viewState.commands.get(name);
    if (cmd) {
      await cmd.run();
    } else {
      throw new Error(`Command ${name} not found`);
    }
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

// Third party web dependencies
import {
  autocompletion,
  cLanguage,
  closeBrackets,
  closeBracketsKeymap,
  CompletionContext,
  completionKeymap,
  CompletionResult,
  cppLanguage,
  csharpLanguage,
  dartLanguage,
  drawSelection,
  dropCursor,
  EditorSelection,
  EditorState,
  EditorView,
  gitIgnoreCompiler,
  highlightSpecialChars,
  history,
  historyKeymap,
  indentOnInput,
  indentWithTab,
  javaLanguage,
  javascriptLanguage,
  jsonLanguage,
  KeyBinding,
  keymap,
  kotlinLanguage,
  LanguageDescription,
  LanguageSupport,
  markdown,
  objectiveCLanguage,
  objectiveCppLanguage,
  postgresqlLanguage,
  protobufLanguage,
  pythonLanguage,
  runScopeHandlers,
  rustLanguage,
  scalaLanguage,
  searchKeymap,
  shellLanguage,
  sqlLanguage,
  standardKeymap,
  StreamLanguage,
  syntaxHighlighting,
  syntaxTree,
  tomlLanguage,
  typescriptLanguage,
  ViewPlugin,
  ViewUpdate,
  xmlLanguage,
  yamlLanguage,
} from "../common/deps.ts";
import { SilverBulletHooks } from "../common/manifest.ts";
import {
  loadMarkdownExtensions,
  MDExt,
} from "../common/markdown_parser/markdown_ext.ts";
import buildMarkdown from "../common/markdown_parser/parser.ts";
import { Space } from "./space.ts";
import { markdownSyscalls } from "./syscalls/markdown.ts";
import { FilterOption, PageMeta } from "./types.ts";
import { isMacLike, parseYamlSettings, safeRun } from "../common/util.ts";
import { createSandbox } from "../plugos/environments/webworker_sandbox.ts";
import { EventHook } from "../plugos/hooks/event.ts";
import assetSyscalls from "../plugos/syscalls/asset.ts";
import { eventSyscalls } from "../plugos/syscalls/event.ts";
import { System } from "../plugos/system.ts";
import { cleanModePlugins } from "./cm_plugins/clean.ts";
import { CollabState } from "./cm_plugins/collab.ts";
import {
  attachmentExtension,
  pasteLinkExtension,
} from "./cm_plugins/editor_paste.ts";
import { inlineImagesPlugin } from "./cm_plugins/inline_image.ts";
import { lineWrapper } from "./cm_plugins/line_wrapper.ts";
import { smartQuoteKeymap } from "./cm_plugins/smart_quotes.ts";
import { Confirm, Prompt } from "./components/basic_modals.tsx";
import { CommandPalette } from "./components/command_palette.tsx";
import { FilterList } from "./components/filter.tsx";
import { PageNavigator } from "./components/page_navigator.tsx";
import { Panel } from "./components/panel.tsx";
import { TopBar } from "./components/top_bar.tsx";
import {
  BookIcon,
  HomeIcon,
  preactRender,
  TerminalIcon,
  useEffect,
  useReducer,
  vim,
  yUndoManagerKeymap,
} from "./deps.ts";
import { AppCommand, CommandHook } from "./hooks/command.ts";
import { SlashCommandHook } from "./hooks/slash_command.ts";
import { PathPageNavigator } from "./navigator.ts";
import reducer from "./reducer.ts";
import customMarkdownStyle from "./style.ts";
import { collabSyscalls } from "./syscalls/collab.ts";
import { editorSyscalls } from "./syscalls/editor.ts";
import { spaceSyscalls } from "./syscalls/space.ts";
import { systemSyscalls } from "./syscalls/system.ts";
import {
  Action,
  AppViewState,
  BuiltinSettings,
  initialViewState,
} from "./types.ts";

import type {
  AppEvent,
  ClickEvent,
  CompleteEvent,
} from "../plug-api/app_event.ts";
import { CodeWidgetHook } from "./hooks/code_widget.ts";
import { throttle } from "../common/async_util.ts";
import { readonlyMode } from "./cm_plugins/readonly.ts";
import { PageNamespaceHook } from "../common/hooks/page_namespace.ts";
import { CronHook } from "../plugos/hooks/cron.ts";
import { pageIndexSyscalls } from "./syscalls/index.ts";
import { storeSyscalls } from "../plugos/syscalls/store.dexie_browser.ts";
import { PlugSpacePrimitives } from "../common/spaces/plug_space_primitives.ts";
import { IndexedDBSpacePrimitives } from "../common/spaces/indexeddb_space_primitives.ts";
import { FileMetaSpacePrimitives } from "../common/spaces/file_meta_space_primitives.ts";
import { EventedSpacePrimitives } from "../common/spaces/evented_space_primitives.ts";
import { clientStoreSyscalls } from "./syscalls/clientStore.ts";
import { sandboxFetchSyscalls } from "./syscalls/fetch.ts";
import { shellSyscalls } from "./syscalls/shell.ts";
import { SyncService } from "./sync_service.ts";
import { yamlSyscalls } from "./syscalls/yaml.ts";
import { simpleHash } from "../common/crypto.ts";
import { DexieKVStore } from "../plugos/lib/kv_store.dexie.ts";
import { SyncStatus } from "../common/spaces/sync.ts";
import { HttpSpacePrimitives } from "../common/spaces/http_space_primitives.ts";
import { FallbackSpacePrimitives } from "../common/spaces/fallback_space_primitives.ts";
import { syncSyscalls } from "./syscalls/sync.ts";
import { FilteredSpacePrimitives } from "../common/spaces/filtered_space_primitives.ts";
import { globToRegExp } from "https://deno.land/std@0.189.0/path/glob.ts";

const frontMatterRegex = /^---\n(([^\n]|\n)*?)---\n/;

class PageState {
  constructor(
    readonly scrollTop: number,
    readonly selection: EditorSelection,
  ) {}
}

const saveInterval = 1000;

declare global {
  interface Window {
    // Injected via index.html
    silverBulletConfig: {
      spaceFolderPath: string;
      syncEndpoint: string;
    };
    editor: Editor;
  }
}

// TODO: Oh my god, need to refactor this
export class Editor {
  readonly commandHook: CommandHook;
  readonly slashCommandHook: SlashCommandHook;
  openPages = new Map<string, PageState>();
  editorView?: EditorView;
  viewState: AppViewState = initialViewState;
  viewDispatch: (action: Action) => void = () => {};
  space: Space;
  remoteSpacePrimitives: HttpSpacePrimitives;

  pageNavigator?: PathPageNavigator;
  eventHook: EventHook;
  codeWidgetHook: CodeWidgetHook;

  saveTimeout: any;
  debouncedUpdateEvent = throttle(() => {
    this.eventHook
      .dispatchEvent("editor:updated")
      .catch((e) => console.error("Error dispatching editor:updated event", e));
  }, 1000);
  system: System<SilverBulletHooks>;
  mdExtensions: MDExt[] = [];

  // Track if plugs have been updated since sync cycle
  private plugsUpdated = false;
  fullSyncCompleted = false;

  // Runtime state (that doesn't make sense in viewState)
  collabState?: CollabState;
  syncService: SyncService;
  settings?: BuiltinSettings;
  kvStore: DexieKVStore;

  constructor(
    parent: Element,
  ) {
    const runtimeConfig = window.silverBulletConfig;

    // Instantiate a PlugOS system
    const system = new System<SilverBulletHooks>();
    this.system = system;

    // Generate a semi-unique prefix for the database so not to reuse databases for different space paths
    const dbPrefix = "" + simpleHash(runtimeConfig.spaceFolderPath);

    // Attach the page namespace hook
    const namespaceHook = new PageNamespaceHook();
    system.addHook(namespaceHook);

    // Event hook
    this.eventHook = new EventHook();
    system.addHook(this.eventHook);

    // Cron hook
    const cronHook = new CronHook(system);
    system.addHook(cronHook);

    const indexSyscalls = pageIndexSyscalls(
      `${dbPrefix}_page_index`,
      globalThis.indexedDB,
    );

    this.kvStore = new DexieKVStore(
      `${dbPrefix}_store`,
      "data",
      globalThis.indexedDB,
    );

    const storeCalls = storeSyscalls(this.kvStore);

    // Setup space
    this.remoteSpacePrimitives = new HttpSpacePrimitives(
      runtimeConfig.syncEndpoint,
      runtimeConfig.spaceFolderPath,
      true,
    );

    const plugSpacePrimitives = new PlugSpacePrimitives(
      // Using fallback space primitives here to allow (by default) local reads to "fall through" to HTTP when files aren't synced yet
      new FallbackSpacePrimitives(
        new IndexedDBSpacePrimitives(
          `${dbPrefix}_space`,
          globalThis.indexedDB,
        ),
        this.remoteSpacePrimitives,
      ),
      namespaceHook,
    );

    let fileFilterFn: (s: string) => boolean = () => true;
    const localSpacePrimitives = new FilteredSpacePrimitives(
      new FileMetaSpacePrimitives(
        new EventedSpacePrimitives(
          plugSpacePrimitives,
          this.eventHook,
        ),
        indexSyscalls,
      ),
      (meta) => fileFilterFn(meta.name),
      async () => {
        await this.loadSettings();
        if (typeof this.settings?.spaceIgnore === "string") {
          fileFilterFn = gitIgnoreCompiler(this.settings.spaceIgnore).accepts;
        } else {
          fileFilterFn = () => true;
        }
      },
    );

    this.space = new Space(localSpacePrimitives, this.kvStore);
    this.space.watch();

    this.syncService = new SyncService(
      localSpacePrimitives,
      this.remoteSpacePrimitives,
      this.kvStore,
      this.eventHook,
      (path) => {
        // TODO: At some point we should remove the data.db exception here
        return path !== "data.db" && !plugSpacePrimitives.isLikelyHandled(path);
      },
    );

    // Code widget hook
    this.codeWidgetHook = new CodeWidgetHook();
    this.system.addHook(this.codeWidgetHook);

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
      state: this.createEditorState("", "", false),
      parent: document.getElementById("sb-editor")!,
    });

    // Syscalls available to all plugs
    this.system.registerSyscalls(
      [],
      eventSyscalls(this.eventHook),
      editorSyscalls(this),
      spaceSyscalls(this),
      systemSyscalls(this, this.system),
      markdownSyscalls(buildMarkdown(this.mdExtensions)),
      assetSyscalls(this.system),
      collabSyscalls(this),
      yamlSyscalls(),
      storeCalls,
      indexSyscalls,
      syncSyscalls(this.syncService),
      // LEGACY
      clientStoreSyscalls(storeCalls),
    );

    // Syscalls that require some additional permissions
    this.system.registerSyscalls(
      ["fetch"],
      sandboxFetchSyscalls(this.remoteSpacePrimitives),
    );

    this.system.registerSyscalls(
      ["shell"],
      shellSyscalls(this.remoteSpacePrimitives),
    );

    // Make keyboard shortcuts work even when the editor is in read only mode or not focused
    globalThis.addEventListener("keydown", (ev) => {
      if (!this.editorView?.hasFocus) {
        if ((ev.target as any).closest(".cm-editor")) {
          // In some cm element, let's back out
          return;
        }
        if (runScopeHandlers(this.editorView!, ev, "editor")) {
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
        this.viewDispatch({ type: "show-palette", context: this.getContext() });
      }
    });

    this.eventHook.addLocalListener("plug:changed", async (fileName) => {
      console.log("Plug updated, reloading:", fileName);
      system.unload(fileName);
      await system.load(
        // await this.space.readFile(fileName, "utf8"),
        new URL(`/.fs/${fileName}`, location.href),
        createSandbox,
      );
      this.plugsUpdated = true;
    });
  }

  get currentPage(): string | undefined {
    return this.viewState.currentPage;
  }

  async init() {
    this.focus();

    this.space.on({
      pageChanged: (meta) => {
        if (this.currentPage === meta.name) {
          console.log("Page changed elsewhere, reloading");
          this.flashNotification("Page changed elsewhere, reloading");
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

    // Load settings
    this.settings = await this.loadSettings();

    this.pageNavigator = new PathPageNavigator(
      this.settings.indexPage,
    );

    await this.reloadPlugs();

    this.pageNavigator.subscribe(async (pageName, pos: number | string) => {
      console.log("Now navigating to", pageName);
      if (!this.editorView) {
        return;
      }

      const stateRestored = await this.loadPage(pageName);
      if (pos) {
        if (typeof pos === "string") {
          console.log("Navigating to anchor", pos);

          // We're going to look up the anchor through a direct page store query...
          const posLookup = await this.system.localSyscall(
            "core",
            "index.get",
            [
              pageName,
              `a:${pageName}:${pos}`,
            ],
          );

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
        // Somewhat ad-hoc way to determine if the document contains frontmatter and if so, putting the cursor _after it_.
        const pageText = this.editorView.state.sliceDoc();

        // Default the cursor to be at position 0
        let initialCursorPos = 0;
        const match = frontMatterRegex.exec(pageText);
        if (match) {
          // Frontmatter found, put cursor after it
          initialCursorPos = match[0].length;
        }
        // By default scroll to the top
        this.editorView.scrollDOM.scrollTop = 0;
        this.editorView.dispatch({
          selection: { anchor: initialCursorPos },
          // And then scroll down if required
          scrollIntoView: true,
        });
      }
    });

    this.loadCustomStyles().catch(console.error);

    // Kick off background sync
    this.syncService.start();

    this.eventHook.addLocalListener("sync:success", async (operations) => {
      // console.log("Operations", operations);
      if (operations > 0) {
        // Update the page list
        await this.space.updatePageList();
      }
      if (operations !== undefined) {
        // "sync:success" is called with a number of operations only from syncSpace(), not from syncing individual pages
        this.fullSyncCompleted = true;
      }
      if (this.plugsUpdated) {
        // To register new commands, update editor state based on new plugs
        this.rebuildEditorState();
        this.dispatchAppEvent("editor:pageLoaded", this.currentPage);
        if (operations) {
          // Likely initial sync so let's show visually that we're synced now
          this.flashNotification(`Synced ${operations} files`, "info");
        }
      }
      // Reset for next sync cycle
      this.plugsUpdated = false;

      this.viewDispatch({ type: "sync-change", synced: true });
    });
    this.eventHook.addLocalListener("sync:error", (name) => {
      this.viewDispatch({ type: "sync-change", synced: false });
    });
    this.eventHook.addLocalListener("sync:conflict", (name) => {
      this.flashNotification(
        `Sync: conflict detected for ${name} - conflict copy created`,
        "error",
      );
    });
    this.eventHook.addLocalListener("sync:progress", (status: SyncStatus) => {
      this.flashNotification(
        `Sync: ${
          Math.round(status.filesProcessed / status.totalFiles * 10000) /
          100
        }% — processed ${status.filesProcessed} out of ${status.totalFiles}`,
        "info",
      );
    });

    await this.dispatchAppEvent("editor:init");
  }

  async loadSettings(): Promise<BuiltinSettings> {
    let settingsText: string | undefined;

    try {
      settingsText = (await this.space.readPage("SETTINGS")).text;
    } catch (e: any) {
      console.log("No SETTINGS page, falling back to default");
      settingsText = "```yaml\nindexPage: index\n```\n";
    }
    const settings = parseYamlSettings(settingsText!) as BuiltinSettings;

    if (!settings.indexPage) {
      settings.indexPage = "index";
    }
    return settings;
  }

  save(immediate = false): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
      }
      this.saveTimeout = setTimeout(
        () => {
          if (this.currentPage) {
            if (
              !this.viewState.unsavedChanges ||
              this.viewState.uiOptions.forcedROMode
            ) {
              // No unsaved changes, or read-only mode, not gonna save
              return resolve();
            }
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
    const id = Math.floor(Math.random() * 1000000);
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
      type === "info" ? 4000 : 5000,
    );
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
          this.focus();
          resolve(option);
        },
      });
    });
  }

  prompt(
    message: string,
    defaultValue = "",
  ): Promise<string | undefined> {
    return new Promise((resolve) => {
      this.viewDispatch({
        type: "show-prompt",
        message,
        defaultValue,
        callback: (value: string | undefined) => {
          this.viewDispatch({ type: "hide-prompt" });
          this.focus();
          resolve(value);
        },
      });
    });
  }

  confirm(
    message: string,
  ): Promise<boolean> {
    return new Promise((resolve) => {
      this.viewDispatch({
        type: "show-confirm",
        message,
        callback: (value: boolean) => {
          this.viewDispatch({ type: "hide-confirm" });
          this.focus();
          resolve(value);
        },
      });
    });
  }

  dispatchAppEvent(name: AppEvent, data?: any): Promise<any[]> {
    return this.eventHook.dispatchEvent(name, data);
  }

  createEditorState(
    pageName: string,
    text: string,
    readOnly: boolean,
  ): EditorState {
    const commandKeyBindings: KeyBinding[] = [];
    for (const def of this.commandHook.editorCommands.values()) {
      if (def.command.key) {
        commandKeyBindings.push({
          key: def.command.key,
          mac: def.command.mac,
          run: (): boolean => {
            if (def.command.contexts) {
              const context = this.getContext();
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
    // deno-lint-ignore no-this-alias
    const editor = this;
    let touchCount = 0;

    return EditorState.create({
      doc: this.collabState ? this.collabState.ytext.toString() : text,
      extensions: [
        // Not using CM theming right now, but some extensions depend on the "dark" thing
        EditorView.theme({}, { dark: this.viewState.uiOptions.darkMode }),
        // Enable vim mode, or not
        [...editor.viewState.uiOptions.vimMode ? [vim({ status: true })] : []],
        [
          ...readOnly || editor.viewState.uiOptions.forcedROMode
            ? [readonlyMode()]
            : [],
        ],
        // The uber markdown mode
        markdown({
          base: buildMarkdown(this.mdExtensions),
          codeLanguages: [
            LanguageDescription.of({
              name: "yaml",
              alias: ["meta", "data", "embed"],
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
            LanguageDescription.of({
              name: "sql",
              alias: ["sql"],
              support: new LanguageSupport(StreamLanguage.define(sqlLanguage)),
            }),
            LanguageDescription.of({
              name: "postgresql",
              alias: ["pgsql", "postgres"],
              support: new LanguageSupport(
                StreamLanguage.define(postgresqlLanguage),
              ),
            }),
            LanguageDescription.of({
              name: "rust",
              alias: ["rs"],
              support: new LanguageSupport(StreamLanguage.define(rustLanguage)),
            }),
            LanguageDescription.of({
              name: "css",
              support: new LanguageSupport(StreamLanguage.define(sqlLanguage)),
            }),
            LanguageDescription.of({
              name: "python",
              alias: ["py"],
              support: new LanguageSupport(
                StreamLanguage.define(pythonLanguage),
              ),
            }),
            LanguageDescription.of({
              name: "protobuf",
              alias: ["proto"],
              support: new LanguageSupport(
                StreamLanguage.define(protobufLanguage),
              ),
            }),
            LanguageDescription.of({
              name: "shell",
              alias: ["sh", "bash", "zsh", "fish"],
              support: new LanguageSupport(
                StreamLanguage.define(shellLanguage),
              ),
            }),
            LanguageDescription.of({
              name: "swift",
              support: new LanguageSupport(StreamLanguage.define(rustLanguage)),
            }),
            LanguageDescription.of({
              name: "toml",
              support: new LanguageSupport(StreamLanguage.define(tomlLanguage)),
            }),
            LanguageDescription.of({
              name: "json",
              support: new LanguageSupport(StreamLanguage.define(jsonLanguage)),
            }),
            LanguageDescription.of({
              name: "xml",
              support: new LanguageSupport(StreamLanguage.define(xmlLanguage)),
            }),
            LanguageDescription.of({
              name: "c",
              support: new LanguageSupport(StreamLanguage.define(cLanguage)),
            }),
            LanguageDescription.of({
              name: "cpp",
              alias: ["c++", "cxx"],
              support: new LanguageSupport(StreamLanguage.define(cppLanguage)),
            }),
            LanguageDescription.of({
              name: "java",
              support: new LanguageSupport(StreamLanguage.define(javaLanguage)),
            }),
            LanguageDescription.of({
              name: "csharp",
              alias: ["c#", "cs"],
              support: new LanguageSupport(
                StreamLanguage.define(csharpLanguage),
              ),
            }),
            LanguageDescription.of({
              name: "scala",
              alias: ["sc"],
              support: new LanguageSupport(
                StreamLanguage.define(scalaLanguage),
              ),
            }),
            LanguageDescription.of({
              name: "kotlin",
              alias: ["kt", "kts"],
              support: new LanguageSupport(
                StreamLanguage.define(kotlinLanguage),
              ),
            }),
            LanguageDescription.of({
              name: "objc",
              alias: ["objective-c", "objectivec"],
              support: new LanguageSupport(
                StreamLanguage.define(objectiveCLanguage),
              ),
            }),
            LanguageDescription.of({
              name: "objcpp",
              alias: [
                "objc++",
                "objective-cpp",
                "objectivecpp",
                "objective-c++",
                "objectivec++",
              ],
              support: new LanguageSupport(
                StreamLanguage.define(objectiveCppLanguage),
              ),
            }),
            LanguageDescription.of({
              name: "dart",
              support: new LanguageSupport(StreamLanguage.define(dartLanguage)),
            }),
          ],
          addKeymap: true,
        }),
        syntaxHighlighting(customMarkdownStyle(this.mdExtensions)),
        autocompletion({
          override: [
            this.editorComplete.bind(this),
            this.slashCommandHook.slashCommandCompleter.bind(
              this.slashCommandHook,
            ),
          ],
        }),
        inlineImagesPlugin(this.space),
        highlightSpecialChars(),
        history(),
        drawSelection(),
        dropCursor(),
        indentOnInput(),
        ...cleanModePlugins(this),
        EditorView.lineWrapping,
        lineWrapper([
          { selector: "ATXHeading1", class: "sb-line-h1" },
          { selector: "ATXHeading2", class: "sb-line-h2" },
          { selector: "ATXHeading3", class: "sb-line-h3" },
          { selector: "ATXHeading4", class: "sb-line-h4" },
          { selector: "ListItem", class: "sb-line-li", nesting: true },
          { selector: "Blockquote", class: "sb-line-blockquote" },
          { selector: "Task", class: "sb-line-task" },
          { selector: "CodeBlock", class: "sb-line-code" },
          { selector: "FencedCode", class: "sb-line-fenced-code" },
          { selector: "Comment", class: "sb-line-comment" },
          { selector: "BulletList", class: "sb-line-ul" },
          { selector: "OrderedList", class: "sb-line-ol" },
          { selector: "TableHeader", class: "sb-line-tbl-header" },
          { selector: "FrontMatter", class: "sb-frontmatter" },
        ]),
        keymap.of([
          ...smartQuoteKeymap,
          ...closeBracketsKeymap,
          ...standardKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...completionKeymap,
          ...(this.collabState ? yUndoManagerKeymap : []),
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
              this.viewDispatch({
                type: "show-palette",
                context: this.getContext(),
              });
              return true;
            },
          },
          {
            key: "Ctrl-.",
            mac: "Cmd-.",
            run: (): boolean => {
              this.viewDispatch({
                type: "show-palette",
                context: this.getContext(),
              });
              return true;
            },
          },
        ]),
        EditorView.domEventHandlers({
          // This may result in duplicated touch events on mobile devices
          touchmove: (event: TouchEvent, view: EditorView) => {
            touchCount++;
          },
          touchend: (event: TouchEvent, view: EditorView) => {
            if (touchCount === 0) {
              safeRun(async () => {
                const touch = event.changedTouches.item(0)!;
                const clickEvent: ClickEvent = {
                  page: pageName,
                  ctrlKey: event.ctrlKey,
                  metaKey: event.metaKey,
                  altKey: event.altKey,
                  pos: view.posAtCoords({
                    x: touch.clientX,
                    y: touch.clientY,
                  })!,
                };
                await this.dispatchAppEvent("page:click", clickEvent);
              });
            }
            touchCount = 0;
          },
          mousedown: (event: MouseEvent, view: EditorView) => {
            // Make sure <a> tags are clicked without moving the cursor there
            if (!event.altKey && event.target instanceof Element) {
              const parentA = event.target.closest("a");
              if (parentA) {
                event.stopPropagation();
                event.preventDefault();
                const clickEvent: ClickEvent = {
                  page: pageName,
                  ctrlKey: event.ctrlKey,
                  metaKey: event.metaKey,
                  altKey: event.altKey,
                  pos: view.posAtCoords({
                    x: event.x,
                    y: event.y,
                  })!,
                };
                this.dispatchAppEvent("page:click", clickEvent).catch(
                  console.error,
                );
              }
            }
          },
          click: (event: MouseEvent, view: EditorView) => {
            safeRun(async () => {
              const clickEvent: ClickEvent = {
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
        ...[this.collabState ? this.collabState.collabExtension() : []],
      ],
    });
  }

  async reloadPlugs() {
    console.log("Loading plugs");
    await this.space.updatePageList();
    await this.system.unloadAll();
    console.log("(Re)loading plugs");
    await Promise.all((await this.space.listPlugs()).map(async (plugName) => {
      try {
        await this.system.load(
          new URL(`/.fs/${plugName}`, location.href),
          createSandbox,
        );
      } catch (e: any) {
        console.error("Could not load plug", plugName, "error:", e.message);
      }
    }));
    this.rebuildEditorState();
    await this.dispatchAppEvent("plugs:loaded");
  }

  rebuildEditorState() {
    const editorView = this.editorView;
    console.log("Rebuilding editor state");

    // Load all syntax extensions
    this.mdExtensions = loadMarkdownExtensions(this.system);
    // And reload the syscalls to use the new syntax extensions
    this.system.registerSyscalls(
      [],
      markdownSyscalls(buildMarkdown(this.mdExtensions)),
    );

    if (editorView && this.currentPage) {
      // And update the editor if a page is loaded
      this.saveState(this.currentPage);

      editorView.setState(
        this.createEditorState(
          this.currentPage,
          editorView.state.sliceDoc(),
          this.viewState.currentPageMeta?.perm === "ro",
        ),
      );
      if (editorView.contentDOM) {
        this.tweakEditorDOM(
          editorView.contentDOM,
        );
      }

      this.restoreState(this.currentPage);
    }
  }

  // Code completion support
  private async completeWithEvent(
    context: CompletionContext,
    eventName: AppEvent,
  ): Promise<CompletionResult | null> {
    const editorState = context.state;
    const selection = editorState.selection.main;
    const line = editorState.doc.lineAt(selection.from);
    const linePrefix = line.text.slice(0, selection.from - line.from);

    const results = await this.dispatchAppEvent(eventName, {
      linePrefix,
      pos: selection.from,
    } as CompleteEvent);
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

  editorComplete(
    context: CompletionContext,
  ): Promise<CompletionResult | null> {
    return this.completeWithEvent(context, "editor:complete");
  }

  miniEditorComplete(
    context: CompletionContext,
  ): Promise<CompletionResult | null> {
    return this.completeWithEvent(context, "minieditor:complete");
  }

  async reloadPage() {
    console.log("Reloading page");
    clearTimeout(this.saveTimeout);
    await this.loadPage(this.currentPage!);
  }

  focus() {
    this.editorView!.focus();
  }

  async navigate(
    name: string,
    pos?: number | string,
    replaceState = false,
    newWindow = false,
  ) {
    if (!name) {
      name = this.settings!.indexPage;
    }

    if (newWindow) {
      const win = window.open(`${location.origin}/${name}`, "_blank");
      if (win) {
        win.focus();
      }
      return;
    }
    await this.pageNavigator!.navigate(name, pos, replaceState);
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
      if (previousPage !== pageName) {
        await this.save(true);
        // And stop the collab session
        if (this.collabState) {
          this.collabState.stop();
          this.collabState = undefined;
        }
      }
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

    const editorState = this.createEditorState(
      pageName,
      doc.text,
      doc.meta.perm === "ro",
    );
    editorView.setState(editorState);
    if (editorView.contentDOM) {
      this.tweakEditorDOM(editorView.contentDOM);
    }
    const stateRestored = this.restoreState(pageName);
    this.space.watchPage(pageName);

    this.viewDispatch({
      type: "page-loaded",
      meta: doc.meta,
    });

    // Note: these events are dispatched asynchronously deliberately (not waiting for results)
    if (loadingDifferentPage) {
      this.eventHook.dispatchEvent("editor:pageLoaded", pageName).catch(
        console.error,
      );
    } else {
      this.eventHook.dispatchEvent("editor:pageReloaded", pageName).catch(
        console.error,
      );
    }

    return stateRestored;
  }

  tweakEditorDOM(contentDOM: HTMLElement) {
    contentDOM.spellcheck = true;
    contentDOM.setAttribute("autocorrect", "on");
    contentDOM.setAttribute("autocapitalize", "on");
  }

  async loadCustomStyles() {
    try {
      const { text: stylesText } = await this.space.readPage("STYLES");
      const cssBlockRegex = /```css([^`]+)```/;
      const match = cssBlockRegex.exec(stylesText);
      if (!match) {
        return;
      }
      const css = match[1];
      document.getElementById("custom-styles")!.innerHTML = css;
    } catch {
      // Nuthin'
    }
  }

  private restoreState(pageName: string): boolean {
    const pageState = this.openPages.get(pageName);
    const editorView = this.editorView!;
    if (pageState) {
      // Restore state
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

  ViewComponent() {
    const [viewState, dispatch] = useReducer(reducer, initialViewState);
    this.viewState = viewState;
    this.viewDispatch = dispatch;

    // deno-lint-ignore no-this-alias
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
        );
      }
    }, [viewState.uiOptions.forcedROMode]);

    useEffect(() => {
      this.rebuildEditorState();
      this.dispatchAppEvent("editor:modeswitch");
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
            currentPage={this.currentPage}
            completer={this.miniEditorComplete.bind(this)}
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
            commands={this.getCommandsByContext(viewState)}
            vimMode={viewState.uiOptions.vimMode}
            darkMode={viewState.uiOptions.darkMode}
            completer={this.miniEditorComplete.bind(this)}
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
            completer={this.miniEditorComplete.bind(this)}
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
            completer={this.miniEditorComplete.bind(this)}
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
          synced={viewState.synced}
          unsavedChanges={viewState.unsavedChanges}
          isLoading={viewState.isLoading}
          vimMode={viewState.uiOptions.vimMode}
          darkMode={viewState.uiOptions.darkMode}
          completer={editor.miniEditorComplete.bind(editor)}
          onRename={async (newName) => {
            if (!newName) {
              // Always move cursor to the start of the page
              editor.editorView?.dispatch({
                selection: { anchor: 0 },
              });
              editor.focus();
              return;
            }
            console.log("Now renaming page to...", newName);
            await editor.system.loadedPlugs.get("core")!.invoke(
              "renamePage",
              [{ page: newName }],
            );
            editor.focus();
          }}
          actionButtons={[
            {
              icon: HomeIcon,
              description: `Go home (Alt-h)`,
              callback: () => {
                editor.navigate("");
              },
            },
            {
              icon: BookIcon,
              description: `Open page (${isMacLike() ? "Cmd-k" : "Ctrl-k"})`,
              callback: () => {
                dispatch({ type: "start-navigate" });
                this.space.updatePageList();
              },
            },
            {
              icon: TerminalIcon,
              description: `Run command (${isMacLike() ? "Cmd-/" : "Ctrl-/"})`,
              callback: () => {
                dispatch({ type: "show-palette", context: this.getContext() });
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

  async runCommandByName(name: string, ...args: any[]) {
    const cmd = this.viewState.commands.get(name);
    if (cmd) {
      await cmd.run();
    } else {
      throw new Error(`Command ${name} not found`);
    }
  }

  render(container: Element) {
    const ViewComponent = this.ViewComponent.bind(this);
    preactRender(<ViewComponent />, container);
  }

  private getCommandsByContext(
    state: AppViewState,
  ): Map<string, AppCommand> {
    const commands = new Map(state.commands);
    for (const [k, v] of state.commands.entries()) {
      if (
        v.command.contexts &&
        (!state.showCommandPaletteContext ||
          !v.command.contexts.includes(state.showCommandPaletteContext))
      ) {
        commands.delete(k);
      }
    }

    return commands;
  }

  private getContext(): string | undefined {
    const state = this.editorView!.state;
    const selection = state.selection.main;
    if (selection.empty) {
      return syntaxTree(state).resolveInner(selection.from).type.name;
    }
    return;
  }

  startCollab(serverUrl: string, token: string, username: string) {
    if (this.collabState) {
      // Clean up old collab state
      this.collabState.stop();
    }
    const initialText = this.editorView!.state.sliceDoc();
    this.collabState = new CollabState(serverUrl, token, username);
    this.collabState.collabProvider.once("sync", (synced: boolean) => {
      if (this.collabState?.ytext.toString() === "") {
        console.log("Synced value is empty, putting back original text");
        this.collabState?.ytext.insert(0, initialText);
      }
    });
    this.rebuildEditorState();
  }
}

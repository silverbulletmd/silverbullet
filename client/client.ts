import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import { history } from "@codemirror/commands";
import { syntaxTree } from "@codemirror/language";
import type { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { jitter } from "@silverbulletmd/silverbullet/lib/async";
import { deriveDbName } from "@silverbulletmd/silverbullet/lib/crypto";
import {
  encodePageURI,
  encodeRef,
  getNameFromPath,
  isMarkdownPath,
  type Path,
  parseToRef,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import type {
  AppEvent,
  ClickEvent,
  CompleteEvent,
  EnrichedClickEvent,
  SlashCompletions,
} from "@silverbulletmd/silverbullet/type/client";
import type {
  DocumentMeta,
  FileMeta,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import type { StyleObject } from "../plugs/index/space_style.ts";
import { publicVersion } from "../public_version.ts";
import { ClientSystem } from "./client_system.ts";
import {
  buildMarkdownLanguageExtension,
  createEditorState,
  isValidEditor,
} from "./codemirror/editor_state.ts";
import type { Config } from "./config.ts";
import { ContentManager } from "./content_manager.ts";
import { Augmenter } from "./data/data_augmenter.ts";
import { DataStore } from "./data/datastore.ts";
import { EncryptedKvPrimitives } from "./data/encrypted_kv_primitives.ts";
import { IndexedDBKvPrimitives } from "./data/indexeddb_kv_primitives.ts";
import type { KvPrimitives } from "./data/kv_primitives.ts";
import { DataStoreMQ } from "./data/mq.datastore.ts";
import { ObjectIndex } from "./data/object_index.ts";
import { MainUI } from "./editor_ui.tsx";
import { PathPageNavigator, parseRefFromURI } from "./navigator.ts";
import { EventHook } from "./plugos/hooks/event.ts";
import { Space } from "./space.ts";
import { evalStatement } from "./space_lua/eval.ts";
import { parseExpressionString, parse as parseLua } from "./space_lua/parse.ts";
import type { LuaCollectionQuery } from "./space_lua/query_collection.ts";
import {
  LuaEnv,
  LuaRuntimeError,
  LuaStackFrame,
  luaValueToJS,
} from "./space_lua/runtime.ts";
import { resolveASTReference } from "./space_lua.ts";
import { CheckedSpacePrimitives } from "./spaces/checked_space_primitives.ts";
import { fsEndpoint } from "./spaces/constants.ts";
import { EventedSpacePrimitives } from "./spaces/evented_space_primitives.ts";
import { HttpSpacePrimitives } from "./spaces/http_space_primitives.ts";
import type { Command } from "./types/command.ts";
import type {
  AppViewState,
  BootConfig,
  ServiceWorkerSourceMessage,
  ServiceWorkerTargetMessage,
} from "./types/ui.ts";
import { WidgetCache } from "./widget_cache.ts";

// Fetch the file list ever so often, this will implicitly kick off a snapshot comparison resulting in the indexing of changed pages
const fetchFileListInterval = 10000;

declare global {
  var client: Client;
}

// TODO: Clean this up, this has become a god class...
export class Client {
  // Event bus used to communicate between components
  eventHook: EventHook;

  space!: Space;

  clientSystem!: ClientSystem;
  eventedSpacePrimitives!: EventedSpacePrimitives;
  httpSpacePrimitives!: HttpSpacePrimitives;

  ui!: MainUI;
  ds!: DataStore;
  mq!: DataStoreMQ;
  // Used to store additional pageMeta outside the page index itself persistent between client runs (specifically: lastOpened)
  pageMetaAugmenter!: Augmenter;
  // Used to store additional command data outside the objects themselves persistent between client rusn (specifically: lastRun)
  commandAugmenter!: Augmenter;

  // CodeMirror editor
  editorView!: EditorView;
  commandKeyHandlerCompartment?: Compartment;
  vimCompartment?: Compartment;
  indentUnitCompartment?: Compartment;
  undoHistoryCompartment?: Compartment;
  markdownLanguageCompartment?: Compartment;

  // Content manager: handles page/document loading, saving, and editor mode switching
  contentManager!: ContentManager;
  // Track if plugs have been updated since sync cycle
  fullSyncCompleted = false;
  private versionMismatchNotified = false;

  // Set to true once the system is ready (plugs loaded)
  public systemReady: boolean = false;
  private pageNavigator!: PathPageNavigator;
  private onLoadRef: Ref;
  dbPrefix?: string;
  syncMode = false;
  // Widget and image height caching
  widgetCache!: WidgetCache;
  objectIndex!: ObjectIndex;

  constructor(
    private parent: Element,
    public bootConfig: BootConfig,
    readonly config: Config,
  ) {
    this.eventHook = new EventHook(this.config);
    // The third case should only ever happen when the user provides an invalid index env variable
    this.onLoadRef = parseRefFromURI() || this.getIndexRef();
  }

  /**
   * Initialize the client
   * This is a separated from the constructor to allow for async initialization
   */
  async init(encryptionKey?: CryptoKey) {
    const dbName = await deriveDbName(
      "data",
      this.bootConfig.spaceFolderPath,
      document.baseURI.replace(/\/$/, ""),
      encryptionKey,
    );
    // Setup the KV (database)
    let kvPrimitives: KvPrimitives = new IndexedDBKvPrimitives(dbName);
    await (kvPrimitives as IndexedDBKvPrimitives).init();

    console.log("Using IndexedDB database", dbName);

    // See if we need to encrypt this
    if (encryptionKey) {
      kvPrimitives = new EncryptedKvPrimitives(kvPrimitives, encryptionKey);
      await (kvPrimitives as EncryptedKvPrimitives).init();
      console.log("Enabled client-side encryption");
    }
    // Wrap it in a datastore
    this.ds = new DataStore(kvPrimitives);

    this.pageMetaAugmenter = new Augmenter(this.ds, ["aug", "pageMeta"]);
    this.commandAugmenter = new Augmenter(this.ds, ["aug", "command"]);

    // Setup message queue on top of that
    this.mq = new DataStoreMQ(this.ds, this.eventHook);

    this.widgetCache = new WidgetCache(this.ds);
    this.contentManager = new ContentManager(this);

    this.objectIndex = new ObjectIndex(
      this.ds,
      this.config,
      this.eventHook,
      this.mq,
    );

    // Instantiate a PlugOS system
    this.clientSystem = new ClientSystem(
      this,
      this.mq,
      this.ds,
      this.eventHook,
      this.objectIndex,
      this.bootConfig.readOnly,
    );

    this.initSpace();

    this.ui = new MainUI(this);
    this.ui.render(this.parent);

    this.editorView = new EditorView({
      state: createEditorState(this, "", "", true),
      parent: document.getElementById("sb-editor")!,
    });

    this.focus();

    this.clientSystem.init();

    if (this.bootConfig.performWipe) {
      if (confirm("Are you sure you want to wipe the client?")) {
        await this.wipeClient();
        alert("Wipe done. Please reload the page or navigate away.");
        return;
      }
    }
    if (this.bootConfig.performReset) {
      if (
        confirm(
          "Are you sure you want to reset the client? This will wipe all local data and re-sync everything.",
        )
      ) {
        await this.wipeClient();
        location.reload();
        return;
      }
    }

    await this.widgetCache.load();

    // Let's ping the remote space to ensure we're authenticated properly, if not will result in a redirect to auth page
    try {
      await this.httpSpacePrimitives.ping();
    } catch (e: any) {
      if (e.message === "Not authenticated") {
        console.warn("Not authenticated, redirecting to auth page");
        return;
      }
      console.warn(
        "Could not reach remote server, we're offline or the server is down",
        e,
      );
    }

    // Load plugs
    await this.loadPlugs();

    await this.clientSystem.loadLuaScripts();
    await this.initNavigator();
    // await this.initSync();
    await this.eventHook.dispatchEvent("system:ready");
    this.systemReady = true;

    this.initHeadlessRuntime();

    // Load space snapshot and enable events
    await this.eventedSpacePrimitives.enable();

    // Kick off a cron event interval
    setInterval(() => {
      void this.dispatchAppEvent("cron:secondPassed");
    }, 1000);

    // We can load custom styles async
    this.loadCustomStyles().catch(console.error);

    await this.dispatchAppEvent("editor:init");

    // Reset Undo History after editor initialization.
    client.editorView.dispatch({
      effects: client.undoHistoryCompartment?.reconfigure([]),
    });
    client.editorView.dispatch({
      effects: client.undoHistoryCompartment?.reconfigure([history()]),
    });

    // Asynchronously update caches
    this.updatePageListCache().catch(console.error);
    this.updateDocumentListCache().catch(console.error);
  }

  initSpace() {
    this.httpSpacePrimitives = new HttpSpacePrimitives(
      document.baseURI.replace(/\/*$/, "") + fsEndpoint,
      this.bootConfig.spaceFolderPath,
      (message, actionOrRedirectHeader) => {
        alert(message);
        if (actionOrRedirectHeader === "reload") {
          location.reload();
        } else {
          location.href = actionOrRedirectHeader;
        }
      },
    );

    this.eventedSpacePrimitives = new EventedSpacePrimitives(
      new CheckedSpacePrimitives(
        this.httpSpacePrimitives,
        this.bootConfig.readOnly,
      ),
      this.eventHook,
      this.ds,
    );

    // Kick off a regular file listing request to trigger events
    setInterval(() => {
      void this.eventedSpacePrimitives.fetchFileList();
    }, fetchFileListInterval + jitter());

    this.eventHook.addLocalListener("file:changed", async (name: string) => {
      console.log("Queueing index for", name);
      await this.objectIndex.clearFileIndex(name);
      await this.mq.send("indexQueue", name);
    });

    const space = new Space(this.eventedSpacePrimitives, this.eventHook);

    this.space = space;

    let lastSaveTimestamp: number | undefined;

    const updateLastSaveTimestamp = () => {
      lastSaveTimestamp = Date.now();
    };

    this.eventHook.addLocalListener(
      "editor:pageSaving",
      updateLastSaveTimestamp,
    );

    this.eventHook.addLocalListener(
      "editor:documentSaving",
      updateLastSaveTimestamp,
    );

    this.eventHook.addLocalListener(
      "file:changed",
      (path: string, oldHash: number, newHash: number) => {
        // Only reload when watching the current page or document (to avoid reloading when switching pages)
        if (
          this.space.watchInterval &&
          this.currentPath() === path &&
          // Avoid reloading if the page was just saved (5s window)
          (!lastSaveTimestamp || lastSaveTimestamp < Date.now() - 5000) &&
          // Avoid reloading if the previous hash was undefined (first load)
          oldHash !== undefined
        ) {
          console.log(
            "Page changed elsewhere, reloading. Old hash",
            oldHash,
            "new hash",
            newHash,
          );
          this.ui.flashNotification(
            "Page or document changed elsewhere, reloading",
          );
          void this.reloadEditor();
        }
      },
    );

    // Caching a list of known files for the wiki_link highlighter (that checks if a file exists)
    // And keeping it up to date as we go
    this.eventHook.addLocalListener("file:changed", (fileName: string) => {
      // Make sure this file is in the list of known pages
      this.clientSystem.allKnownFiles.add(fileName);
    });
    this.eventHook.addLocalListener("file:deleted", (fileName: string) => {
      this.clientSystem.allKnownFiles.delete(fileName);
    });
    this.eventHook.addLocalListener("file:listed", (allFiles: FileMeta[]) => {
      // Update list of known pages
      this.clientSystem.allKnownFiles.clear();
      allFiles.forEach((f) => {
        this.clientSystem.allKnownFiles.add(f.name);
      });
      this.clientSystem.knownFilesLoaded = true;
    });

    this.space.watch();
  }

  currentPath(): Path {
    return this.ui.viewState.current?.path || this.onLoadRef.path;
  }

  currentName(): string {
    return getNameFromPath(
      this.ui.viewState.current?.path || this.onLoadRef.path,
    );
  }

  currentPageMeta(): PageMeta | undefined {
    return this.ui.viewState.current?.meta;
  }

  dispatchAppEvent(name: AppEvent, ...args: any[]): Promise<any[]> {
    return this.eventHook.dispatchEvent(name, ...args);
  }

  dispatchClickEvent(clickEvent: ClickEvent) {
    const editorState = this.editorView.state;
    const sTree = syntaxTree(editorState);
    const currentNode = sTree.resolveInner(clickEvent.pos);

    const parentNodes: string[] = this.extractParentNodes(
      editorState,
      currentNode,
    );
    const enrichedEvent: EnrichedClickEvent = {
      ...clickEvent,
      parentNodes,
    };
    return this.dispatchAppEvent("page:click", enrichedEvent);
  }

  save(immediate = false): Promise<void> {
    return this.contentManager.save(immediate);
  }

  reportError(e: any, context: string = "") {
    console.error(`Error during ${context}:`, e);

    if (e instanceof LuaRuntimeError) {
      this.ui.flashNotification(`Lua error: ${e.message}`, "error");
      const origin = resolveASTReference(e.sf.astCtx!);
      if (origin) {
        void client.navigate(origin);
      }
    } else {
      this.ui.flashNotification(`Error: ${e.message}`, "error");
    }
  }

  startPageNavigate(mode: "page" | "meta" | "document" | "all") {
    // Then show the page navigator
    this.ui.viewDispatch({ type: "start-navigate", mode });
    // And update the page list cache asynchronously
    this.updatePageListCache().catch(console.error);
    this.updateDocumentListCache().catch(console.error);
  }

  queryLuaObjects<T>(
    tag: string,
    query: LuaCollectionQuery,
    scopedVariables?: Record<string, any>,
  ): Promise<T[]> {
    return this.objectIndex.queryLuaObjects(
      this.clientSystem.spaceLuaEnv.env,
      tag,
      query,
      scopedVariables,
    );
  }

  /**
   * In headless mode, expose Lua eval functions on globalThis for CDP access
   * and signal readiness once the full index is complete.
   */
  private initHeadlessRuntime() {
    if (!(globalThis as any).__sbHeadless) {
      return;
    }
    console.log("[RuntimeAPI] Headless mode, exposing eval functions");
    const spaceLuaEnv = this.clientSystem.spaceLuaEnv;

    const evalLuaCode = async (code: string) => {
      const ast = parseLua(code);
      const scriptEnv = new LuaEnv(spaceLuaEnv.env);
      const tl = new LuaEnv();
      tl.setLocal("_GLOBAL", spaceLuaEnv.env);
      const sf = new LuaStackFrame(tl, ast.ctx);
      const result = await evalStatement(ast, scriptEnv, sf);
      const returnValue =
        result &&
        typeof result === "object" &&
        "ctrl" in result &&
        result.ctrl === "return" &&
        Array.isArray(result.values)
          ? result.values[0]
          : result;
      return (await Promise.resolve(luaValueToJS(returnValue, sf))) ?? null;
    };

    (globalThis as any).__sbEvalLua = (expr: string) =>
      evalLuaCode(`return ${expr}`);
    (globalThis as any).__sbEvalLuaScript = evalLuaCode;

    // Signal readiness after full index is complete
    void this.waitForFullIndex().then(() => {
      console.log(
        "[RuntimeAPI] Ready (eval functions exposed + index complete)",
      );
      (globalThis as any).__sbRuntimeAPIReady = true;
    });
  }

  private async waitForFullIndex(): Promise<void> {
    while (!(await this.objectIndex.hasFullIndexCompleted())) {
      await new Promise<void>((resolve) => {
        const handler = () => {
          this.eventHook.removeLocalListener(
            "mq:emptyQueue:indexQueue",
            handler,
          );
          resolve();
        };
        this.eventHook.addLocalListener("mq:emptyQueue:indexQueue", handler);
      });
    }
  }

  async updatePageListCache() {
    console.log("Updating page list cache");
    // Check if the initial sync has been completed
    const initialIndexCompleted =
      await this.objectIndex.hasFullIndexCompleted();

    let allPages: PageMeta[] = [];

    if (initialIndexCompleted) {
      console.log("Initial index complete, loading full page list via index.");
      // Fetch indexed pages
      allPages = await this.queryLuaObjects<PageMeta>("page", {});
      // Overlay augmented meta values
      await this.pageMetaAugmenter.augmentObjectArray(allPages, "ref");
      // Fetch aspiring pages
      const aspiringPageNames = await this.queryLuaObjects<string>(
        "aspiring-page",
        { select: parseExpressionString("name"), distinct: true },
      );
      // Fetch any augmented page meta data (for now only lastOpened)
      // this.clientSystem.ds.query({prefix: })
      // Map and push aspiring pages directly into allPages
      allPages.push(
        ...aspiringPageNames.map(
          (name): PageMeta => ({
            ref: name,
            tag: "page",
            _isAspiring: true,
            name: name,
            created: "", // Aspiring pages don't have timestamps yet
            lastModified: "", // Aspiring pages don't have timestamps yet
            perm: "rw",
          }),
        ),
      );
    } else {
      console.log(
        "Initial sync not complete or index plug not loaded. Fetching page list directly using space.fetchPageList().",
      );
      try {
        // Call fetchPageList directly
        allPages = await this.space.fetchPageList();

        // Let's do some heuristic-based post processing
        for (const page of allPages) {
          // These are _mostly_ meta pages, let's add a tag for them
          if (page.name.startsWith("Library/")) {
            page.tags = ["meta"];
          }
        }
      } catch (e) {
        console.error("Failed to list pages directly from space:", e);
        // Handle error, maybe show notification or leave list empty
        this.ui.flashNotification(
          "Could not fetch page list directly.",
          "error",
        );
      }
    }

    this.ui.viewDispatch({
      type: "update-page-list",
      allPages: allPages,
    });

    // Async kick-off file listing to bring listing up to date
    void this.space.spacePrimitives.fetchFileList();
  }

  async updateDocumentListCache() {
    console.log("Updating document list cache");
    const allDocuments = await this.queryLuaObjects<DocumentMeta>(
      "document",
      {},
    );

    this.ui.viewDispatch({
      type: "update-document-list",
      allDocuments: allDocuments,
    });
  }

  async startCommandPalette() {
    const commands = this.ui.viewState.commands;
    await this.commandAugmenter.augmentObjectMap(commands);
    this.ui.viewDispatch({
      type: "show-palette",
      commands,
      context: client.getContext(),
    });
  }

  /**
   * Saves when a command was last run to the datastore for command palette ordering
   */
  async registerCommandRun(name: string) {
    await this.commandAugmenter.setAugmentation(name, {
      lastRun: Date.now(),
    });
  }

  async loadPlugs() {
    await this.clientSystem.reloadPlugsFromSpace(this.space);
    await this.dispatchAppEvent("plugs:loaded");
  }

  reconfigureLanguage() {
    if (this.markdownLanguageCompartment) {
      this.editorView.dispatch({
        effects: this.markdownLanguageCompartment.reconfigure(
          buildMarkdownLanguageExtension(this),
        ),
      });
    }
  }

  rebuildEditorState() {
    const editorView = this.editorView;

    editorView.setState(
      createEditorState(
        this,
        this.currentName(),
        editorView.state.sliceDoc(),
        this.currentPageMeta()?.perm === "ro",
      ),
    );
  }

  // Code completion support
  async completeWithEvent(
    context: CompletionContext,
    eventName: AppEvent,
  ): Promise<CompletionResult | SlashCompletions | null> {
    const editorState = context.state;
    const selection = editorState.selection.main;
    const line = editorState.doc.lineAt(selection.from);
    const linePrefix = line.text.slice(0, selection.from - line.from);

    // Build up list of parent nodes, some completions need this
    const sTree = syntaxTree(editorState);
    const currentNode = sTree.resolveInner(editorState.selection.main.from);

    const parentNodes: string[] = this.extractParentNodes(
      editorState,
      currentNode,
    );

    // Dispatch the event
    const results = await this.dispatchAppEvent(eventName, {
      pageName: this.currentName(),
      linePrefix,
      pos: selection.from,
      parentNodes,
    } as CompleteEvent);

    // Merge results
    let currentResult: CompletionResult | null = null;
    for (const result of results) {
      if (!result) {
        continue;
      }
      if (currentResult) {
        // Let's see if we can merge results
        if (currentResult.from !== result.from) {
          console.error(
            "Got completion results from multiple sources with different `from` locators, cannot deal with that",
          );
          console.error(
            "Previously had",
            currentResult,
            "now also got",
            result,
          );
          return null;
        } else {
          // Merge
          currentResult = {
            from: result.from,
            options: [...currentResult.options, ...result.options],
          };
        }
      } else {
        currentResult = result;
      }
    }
    return currentResult;
  }

  isReadOnlyMode(): boolean {
    return this.bootConfig.readOnly || this.currentPageMeta()?.perm === "ro";
  }

  public extractParentNodes(editorState: EditorState, currentNode: SyntaxNode) {
    const parentNodes: string[] = [];
    if (currentNode) {
      let node: SyntaxNode | null = currentNode;
      do {
        if (["FencedCode", "FrontMatter"].includes(node.name)) {
          const body = editorState.sliceDoc(node.from + 3, node.to - 3);
          parentNodes.push(`${node.name}:${body}`);
        } else if (node.name === "LuaDirective") {
          const body = editorState.sliceDoc(node.from + 2, node.to - 1);
          parentNodes.push(`${node.name}:${body}`);
        } else {
          parentNodes.push(node.name);
        }
        node = node.parent;
      } while (node);
    }
    return parentNodes;
  }

  editorComplete(context: CompletionContext): Promise<CompletionResult | null> {
    return this.completeWithEvent(
      context,
      "editor:complete",
    ) as Promise<CompletionResult | null>;
  }

  reloadEditor() {
    return this.contentManager.reloadEditor();
  }

  // Focus the editor
  focus() {
    const viewState = this.ui.viewState;
    if (
      [
        viewState.showCommandPalette,
        viewState.showPageNavigator,
        viewState.showFilterBox,
        viewState.showConfirm,
        viewState.showPrompt,
      ].some(Boolean)
    ) {
      // console.log("not focusing");
      // Some other modal UI element is visible, don't focus editor now
      return;
    }

    if (this.contentManager.isDocumentEditor()) {
      this.contentManager.documentEditor.focus();
    } else {
      this.editorView.focus();
    }
  }

  getIndexRef(): Ref {
    return parseToRef(this.bootConfig.indexPage) || { path: "index.md" };
  }

  async navigate(ref: Ref | null, replaceState = false, newWindow = false) {
    ref ??= this.getIndexRef();

    if (newWindow) {
      console.log(
        "Navigating to new page in new window",
        `${document.baseURI}${encodePageURI(encodeRef(ref))}`,
      );
      const win = globalThis.open(
        `${document.baseURI}${encodePageURI(encodeRef(ref))}`,
        "_blank",
      );
      if (win) {
        win.focus();
      }
      return;
    }

    await this.pageNavigator!.navigate(ref, replaceState);
    this.focus();
  }

  openUrl(url: string, existingWindow = false) {
    if (!existingWindow) {
      const win = globalThis.open(url, "_blank");
      if (win) {
        win.focus();
      }
    } else {
      location.href = url;
    }
  }

  async loadCustomStyles() {
    if (this.bootConfig.disableSpaceStyle) {
      console.warn("Not loading custom styles, since space style is disabled");
      return;
    }
    if (!(await this.objectIndex.hasFullIndexCompleted())) {
      console.warn(
        "Not loading custom styles, since full indexing has not completed yet",
      );
      return;
    }

    const spaceStyles = await this.queryLuaObjects<StyleObject>("space-style", {
      objectVariable: "_",
      orderBy: [
        {
          expr: parseExpressionString("_.priority"),
          desc: true,
        },
      ],
    });
    if (!spaceStyles) {
      return;
    }

    // Prepare separate <style> tag per custom style (for robustness)
    const customStylesContent = spaceStyles
      .map((s) => `<style>${s.style}</style>`)
      .join("\n\n");
    this.ui.viewDispatch({
      type: "set-ui-option",
      key: "customStyles",
      value: customStylesContent,
    });
    document.getElementById("custom-styles")!.innerHTML = customStylesContent;
  }

  async runCommandByName(name: string, args?: any[]) {
    const cmd = this.ui.viewState.commands.get(name);
    if (cmd) {
      if (args) {
        await cmd.run!(args);
      } else {
        await cmd.run!();
      }
    } else {
      throw new Error(`Command ${name} not found`);
    }
  }

  getCommandsByContext(state: AppViewState): Map<string, Command> {
    const currentEditor = client.contentManager.documentEditor?.name;
    const commands = new Map(state.commands);
    for (const [k, v] of state.commands.entries()) {
      if (
        v.contexts &&
        (!state.showCommandPaletteContext ||
          !v.contexts.includes(state.showCommandPaletteContext))
      ) {
        commands.delete(k);
      }

      const requiredEditor = v.requireEditor;
      if (!isValidEditor(currentEditor, requiredEditor)) {
        commands.delete(k);
      }
    }

    return commands;
  }

  getContext(): string | undefined {
    const state = this.editorView.state;
    const selection = state.selection.main;
    if (selection.empty) {
      return syntaxTree(state).resolveInner(selection.from).type.name;
    }
    return;
  }

  async handleServiceWorkerMessage(message: ServiceWorkerSourceMessage) {
    switch (message.type) {
      case "space-sync-complete": {
        this.fullSyncCompleted = true;
        break;
      }
      case "online-status": {
        this.ui.viewDispatch({
          type: "online-status-change",
          isOnline: message.isOnline,
        });
        break;
      }
      case "auth-error": {
        alert(message.message);
        if (
          message.actionOrRedirectHeader &&
          message.actionOrRedirectHeader !== "reload"
        ) {
          location.href = message.actionOrRedirectHeader;
        } else {
          location.reload();
        }
        break;
      }
      case "server-version": {
        if (
          message.serverVersion !== publicVersion &&
          !this.versionMismatchNotified
        ) {
          this.versionMismatchNotified = true;
          this.ui.flashNotification(
            "A new version of SilverBullet client is available. A reload or two is required to update.",
            "warning",
            {
              timeout: 0,
              actions: [{ name: "Reload", run: () => location.reload() }],
            },
          );
        }
        break;
      }
    }

    // Also dispatch it on the event hook for any other listeners
    await this.eventHook.dispatchEvent(
      `service-worker:${message.type}`,
      message,
    );
  }

  private async initNavigator() {
    this.pageNavigator = new PathPageNavigator(this);

    this.pageNavigator.subscribe(async (locationState) => {
      console.log(`Now navigating to ${encodeRef(locationState)}`);

      if (isMarkdownPath(locationState.path)) {
        await this.contentManager.loadPage(locationState);
      } else {
        await this.contentManager.loadDocumentEditor(locationState);
      }

      // Persist this page as the last opened page, we'll use this for cold start PWA loads
      await this.ds.set(["client", "lastOpenedPath"], locationState.path);
    });

    // Initial navigation
    let ref = this.onLoadRef;

    if (ref.details?.type === "header" && ref.details.header === "boot") {
      const path = (await this.ds.get(["client", "lastOpenedPath"])) as Path;

      if (path) {
        console.log("Navigating to last opened page", getNameFromPath(path));
        ref = { path };
      } else {
        // Strip the #boot detail — it's not a real header
        delete ref.details;
      }
    }

    await this.navigate(ref, true);

    console.log("Focusing editor");
    this.focus();
  }

  async wipeClient() {
    // Clean out _other_ IndexedDB databases
    console.log("Wiping IndexedDB databses not connected to this space...");
    const dbName = (this.ds.kv as any).dbName;
    const suffix = dbName.replace("sb_data", "");
    if (indexedDB.databases) {
      const allDbs = await indexedDB.databases();
      for (const db of allDbs) {
        if (!db.name?.endsWith(suffix)) {
          console.log("Deleting database", db.name);
          indexedDB.deleteDatabase(db.name!);
        }
      }
    }
    // Instructe service worker to wipe
    if (navigator.serviceWorker?.controller) {
      // We will attempt to unregister the service worker, best effort
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("message", async (e: any) => {
          const message: ServiceWorkerSourceMessage = e.data;
          if (message.type === "dataWiped") {
            console.log(
              "Got data wipe confirm, uninstalling service worker now",
            );
            const registrations =
              await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
              await registration.unregister();
            }
            console.log("Unregistered all service workers");
            resolve();
          }
        });
        // Send wipe request
        navigator.serviceWorker.getRegistration().then((registration) => {
          console.log(
            "Sending data wipe request to service worker",
            registration,
          );
          registration?.active?.postMessage({
            type: "wipe-data",
          } as ServiceWorkerTargetMessage);
        });
      });
    } else {
      console.info(
        "Service workers not enabled (no HTTPS?), so not unregistering.",
      );
    }
    console.log("Stopping all systems");
    this.space.unwatch();

    console.log("Clearing data store");
    await this.ds.kv.clear();
    console.log("Clearing complete.");
  }

  public async postServiceWorkerMessage(message: ServiceWorkerTargetMessage) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.active) {
      console.warn("No active service worker, skipping message:", message.type);
      return;
    }
    registration.active.postMessage(message);
  }
}

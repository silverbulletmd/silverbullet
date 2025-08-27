import type {
  CompletionContext,
  CompletionResult,
} from "@codemirror/autocomplete";
import type { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import { history, isolateHistory } from "@codemirror/commands";
import type { SyntaxNode } from "@lezer/common";
import { Space } from "./space.ts";
import type {
  AppEvent,
  ClickEvent,
  CompleteEvent,
  EnrichedClickEvent,
  FilterOption,
  SlashCompletions,
} from "@silverbulletmd/silverbullet/type/client";
import { EventHook } from "./hooks/event.ts";
import type { Command } from "../type/command.ts";
import {
  type LocationState,
  parseRefFromURI,
  PathPageNavigator,
} from "./navigator.ts";

import type { AppViewState } from "./ui_types.ts";

import type { PageCreatingContent, PageCreatingEvent } from "../type/event.ts";
import type { StyleObject } from "../plugs/index/style.ts";
import { throttle } from "../lib/async.ts";
import { PlugSpacePrimitives } from "../lib/spaces/plug_space_primitives.ts";
import { EventedSpacePrimitives } from "../lib/spaces/evented_space_primitives.ts";
import { pageSyncInterval, SyncService } from "./sync_service.ts";
import { simpleHash } from "../lib/crypto.ts";
import type { SyncStatus } from "../lib/spaces/sync.ts";
import { HttpSpacePrimitives } from "../lib/spaces/http_space_primitives.ts";
import { FallbackSpacePrimitives } from "../lib/spaces/fallback_space_primitives.ts";
import {
  encodePageURI,
  encodeRef,
  getNameFromPath,
  getOffsetFromHeader,
  getOffsetFromLineColumn,
  isMarkdownPath,
  parseToRef,
  type Path,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import { ClientSystem } from "./client_system.ts";
import { createEditorState, isValidEditor } from "./editor_state.ts";
import { MainUI } from "./editor_ui.tsx";
import type { SpacePrimitives } from "../lib/spaces/space_primitives.ts";
import { DataStore } from "../lib/data/datastore.ts";
import { IndexedDBKvPrimitives } from "../lib/data/indexeddb_kv_primitives.ts";
import { DataStoreMQ } from "../lib/data/mq.datastore.ts";
import { DataStoreSpacePrimitives } from "../lib/spaces/datastore_space_primitives.ts";

import { ReadOnlySpacePrimitives } from "../lib/spaces/ro_space_primitives.ts";
import { LimitedMap } from "../lib/limited_map.ts";
import { fsEndpoint, plugPrefix } from "../lib/spaces/constants.ts";
import { diffAndPrepareChanges } from "./cm_util.ts";
import { DocumentEditor } from "./document_editor.ts";
import { parseExpressionString } from "../lib/space_lua/parse.ts";
import { Config } from "./config.ts";
import type { DocumentMeta, FileMeta, PageMeta } from "../type/index.ts";
import { parseMarkdown } from "./markdown_parser/parser.ts";
import { CheckPathSpacePrimitives } from "../lib/spaces/checked_space_primitives.ts";

const frontMatterRegex = /^---\n(([^\n]|\n)*?)---\n/;

const autoSaveInterval = 1000;

/**
 * Client configuration that is set at boot time, doesn't change at runtime
 */
export type ClientConfig = {
  spaceFolderPath: string;
  indexPage: string;
  readOnly: boolean;
  // These are all configured via ?query parameters, e.g. ?disableSpaceLua=1
  disableSpaceLua?: boolean;
  disableSpaceStyle?: boolean;
  disablePlugs?: boolean;
  disableSync?: boolean;
  performWipe?: boolean;
  performReset?: boolean;
};

declare global {
  var client: Client;
}

type WidgetCacheItem = {
  height: number;
  html: string;
  block?: boolean;
  copyContent?: string;
};

export class Client {
  readonly config = new Config();
  // Event bus used to communicate between components
  eventHook = new EventHook(this.config);

  space!: Space;

  clientSystem!: ClientSystem;
  plugSpaceRemotePrimitives!: PlugSpacePrimitives;
  eventedSpacePrimitives!: EventedSpacePrimitives;
  httpSpacePrimitives!: HttpSpacePrimitives;

  ui!: MainUI;
  ds!: DataStore;
  mq!: DataStoreMQ;

  // CodeMirror editor
  editorView!: EditorView;
  keyHandlerCompartment?: Compartment;
  indentUnitCompartment?: Compartment;
  undoHistoryCompartment?: Compartment;

  // Document editor
  documentEditor: DocumentEditor | null = null;
  saveTimeout?: number;
  debouncedUpdateEvent = throttle(() => {
    this.eventHook
      .dispatchEvent("editor:updated")
      .catch((e) => console.error("Error dispatching editor:updated event", e));
  }, 1000);
  // Track if plugs have been updated since sync cycle
  fullSyncCompleted = false;
  syncService!: SyncService;

  // Sync related stuff
  // Set to true once the system is ready (plugs loaded)
  public systemReady: boolean = false;
  private pageNavigator!: PathPageNavigator;
  private dbPrefix: string;
  private onLoadRef: Ref;
  // Progress circle handling
  private progressTimeout?: number;
  // Widget and image height caching
  private widgetCache = new LimitedMap<WidgetCacheItem>(100); // bodyText -> WidgetCacheItem
  debouncedWidgetCacheFlush = throttle(() => {
    this.ds.set(["cache", "widgets"], this.widgetCache.toJSON())
      .catch(
        console.error,
      );
  }, 2000);
  private widgetHeightCache = new LimitedMap<number>(100); // bodytext -> height
  debouncedWidgetHeightCacheFlush = throttle(() => {
    this.ds.set(
      ["cache", "widgetHeight"],
      this.widgetHeightCache.toJSON(),
    )
      .catch(
        console.error,
      );
  }, 2000);

  constructor(
    private parent: Element,
    public clientConfig: ClientConfig,
  ) {
    // Generate a semi-unique prefix for the database so not to reuse databases for different space paths
    this.dbPrefix = "" +
      simpleHash(
        `${clientConfig.spaceFolderPath}:${
          document.baseURI.replace(/\/*$/, "")
        }`,
      );
    // The third case should only ever happen when the user provides an invalid index env variable
    this.onLoadRef = parseRefFromURI() || this.getIndexRef();
  }

  /**
   * Initialize the client
   * This is a separated from the constructor to allow for async initialization
   */
  async init() {
    // Setup the data store
    const kvPrimitives = new IndexedDBKvPrimitives(
      `${this.dbPrefix}`,
    );
    await kvPrimitives.init();
    this.ds = new DataStore(kvPrimitives);

    // Setup message queue
    this.mq = new DataStoreMQ(this.ds);

    // Instantiate a PlugOS system
    this.clientSystem = new ClientSystem(
      this,
      this.mq,
      this.ds,
      this.eventHook,
      this.clientConfig.readOnly,
    );

    this.initSpace();

    // The sync service gets priveleged primitives, so it can sync files with invalid names
    this.syncService = new SyncService(
      this.eventedSpacePrimitives,
      this.plugSpaceRemotePrimitives,
      this.ds,
      this.eventHook,
      (path) => { // isSyncCandidate
        // Exclude all plug space primitives paths
        return !this.plugSpaceRemotePrimitives.isLikelyHandled(path);
      },
    );

    if (this.clientConfig.disableSync) {
      this.syncService.enabled = false;
    }

    if (!await this.hasInitialSyncCompleted()) {
      console.info(
        "Initial sync has not yet been completed, disabling page and document indexing to speed this up",
      );
      this.eventedSpacePrimitives.enablePageEvents = false;
    }

    this.ui = new MainUI(this);
    this.ui.render(this.parent);

    this.editorView = new EditorView({
      state: createEditorState(this, "", "", true),
      parent: document.getElementById("sb-editor")!,
    });

    this.focus();

    this.clientSystem.init();

    if (this.clientConfig.performWipe) {
      if (confirm("Are you sure you want to wipe the client?")) {
        await this.wipeClient();
        alert("Wipe done. Please reload the page or navigate away.");
        return;
      }
    }
    if (this.clientConfig.performReset) {
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

    await this.loadCaches();

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

    await this.clientSystem.loadScripts();
    await this.initNavigator();
    await this.initSync();
    await this.eventHook.dispatchEvent("system:ready");
    this.systemReady = true;

    // Kick off a cron event interval
    setInterval(() => {
      this.dispatchAppEvent("cron:secondPassed");
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

    // Regularly sync the currently open file
    setInterval(() => {
      try {
        this.syncService.syncFile(this.currentPath()).catch((e: any) => {
          console.error("Interval sync error", e);
        });
      } catch (e: any) {
        console.error("Interval sync error", e);
      }
    }, pageSyncInterval);

    // Asynchronously update caches
    this.updatePageListCache().catch(console.error);
    this.updateDocumentListCache().catch(console.error);
  }

  public hasInitialSyncCompleted(): Promise<boolean> {
    return this.syncService.hasInitialSyncCompleted();
  }

  initSpace() {
    this.httpSpacePrimitives = new HttpSpacePrimitives(
      document.baseURI.replace(/\/*$/, "") + fsEndpoint,
      this.clientConfig.spaceFolderPath,
    );

    let remoteSpacePrimitives: SpacePrimitives = this.httpSpacePrimitives;

    if (this.clientConfig.readOnly) {
      remoteSpacePrimitives = new ReadOnlySpacePrimitives(
        remoteSpacePrimitives,
      );
    }

    this.plugSpaceRemotePrimitives = new PlugSpacePrimitives(
      remoteSpacePrimitives,
      this.clientSystem.namespaceHook,
      this.clientConfig.readOnly ? undefined : "client",
    );

    this.eventedSpacePrimitives = new EventedSpacePrimitives(
      // Using fallback space primitives here to allow (by default) local reads to "fall through" to HTTP when files aren't synced yet
      new FallbackSpacePrimitives(
        new DataStoreSpacePrimitives(
          new DataStore(
            this.ds.kv,
          ),
        ),
        this.plugSpaceRemotePrimitives,
      ),
      this.eventHook,
    );

    const localSpacePrimitives = new CheckPathSpacePrimitives(
      this.eventedSpacePrimitives,
    );

    this.space = new Space(
      localSpacePrimitives,
      this.eventHook,
    );

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
      async (
        path: string,
        _localChange: boolean,
        oldHash: number,
        newHash: number,
      ) => {
        // Only reload when watching the current page or document (to avoid reloading when switching pages)
        if (
          this.space.watchInterval && this.currentPath() === path &&
          // Avoid reloading if the page was just saved (5s window)
          (!lastSaveTimestamp || (lastSaveTimestamp < Date.now() - 5000)) &&
          // Avoid reloading if the previous hash was undefined (first load)
          // Only trigger this after an initial sync has happened
          await this.hasInitialSyncCompleted()
        ) {
          console.log(
            "Page changed elsewhere, reloading. Old hash",
            oldHash,
            "new hash",
            newHash,
          );
          this.flashNotification(
            "Page or document changed elsewhere, reloading",
          );
          this.reloadEditor();
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
    this.eventHook.addLocalListener(
      "file:listed",
      (allFiles: FileMeta[]) => {
        // Update list of known pages
        this.clientSystem.allKnownFiles.clear();
        allFiles.forEach((f) => {
          if (!f.name.startsWith(plugPrefix)) {
            this.clientSystem.allKnownFiles.add(f.name);
          }
        });
      },
    );

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

  // Save the current page
  save(immediate = false): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
      }
      this.saveTimeout = setTimeout(
        () => {
          if (
            !this.ui.viewState.unsavedChanges ||
            this.clientConfig.readOnly
          ) {
            // No unsaved changes, or read-only mode, not gonna save
            return resolve();
          }

          if (this.isDocumentEditor()) {
            console.log("Requesting save for document", this.currentPath());
            this.dispatchAppEvent(
              "editor:documentSaving",
              this.currentPath(),
            );

            // Only thing we can really do is request a save
            this.documentEditor.requestSave();

            return resolve();
          } else {
            console.log("Saving page", this.currentPath());
            this.dispatchAppEvent(
              "editor:pageSaving",
              this.currentName(),
            );
            this.space
              .writePage(
                this.currentName(),
                this.editorView.state.sliceDoc(0),
                true,
              )
              .then(async (meta) => {
                this.ui.viewDispatch({ type: "page-saved" });
                await this.dispatchAppEvent(
                  "editor:pageSaved",
                  this.currentName(),
                  meta,
                );

                // At this all the essential stuff is done, let's proceed
                resolve();

                // In the background we'll fetch any enriched meta data, if any
                const enrichedMeta = await this.clientSystem.getObjectByRef<
                  PageMeta
                >(
                  this.currentName(),
                  "page",
                  this.currentName(),
                );
                if (enrichedMeta) {
                  this.ui.viewDispatch({
                    type: "update-current-page-meta",
                    meta: enrichedMeta,
                  });
                }
              })
              .catch((e) => {
                this.flashNotification(
                  "Could not save page, retrying again in 10 seconds",
                  "error",
                );
                this.saveTimeout = setTimeout(this.save.bind(this), 10000);
                reject(e);
              });
          }
        },
        immediate ? 0 : autoSaveInterval,
      );
    });
  }

  flashNotification(message: string, type: "info" | "error" = "info") {
    const id = Math.floor(Math.random() * 1000000);
    this.ui.viewDispatch({
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
        this.ui.viewDispatch({
          type: "dismiss-notification",
          id: id,
        });
      },
      type === "info" ? 4000 : 5000,
    );
  }

  startPageNavigate(mode: "page" | "meta" | "document" | "all") {
    // Then show the page navigator
    this.ui.viewDispatch({ type: "start-navigate", mode });
    // And update the page list cache asynchronously
    this.updatePageListCache().catch(console.error);

    this.updateDocumentListCache().catch(console.error);
  }

  async updatePageListCache() {
    console.log("Updating page list cache");
    // Check if the initial sync has been completed
    const initialIndexCompleted = await this.clientSystem
      .hasFullIndexCompleted();

    let allPages: PageMeta[] = [];

    if (
      initialIndexCompleted && this.clientSystem.system.loadedPlugs.has("index")
    ) {
      console.log(
        "Initial sync complete and index plug loaded, loading full page list via index.",
      );
      // Fetch actual indexed pages
      allPages = await this.clientSystem.queryLuaObjects<PageMeta>("page", {});
      // Fetch aspiring pages only when using the index
      const aspiringPageNames = await this.clientSystem.queryLuaObjects<string>(
        "aspiring-page",
        { select: parseExpressionString("name"), distinct: true },
      );
      // Map and push aspiring pages directly into allPages
      allPages.push(
        ...aspiringPageNames.map((name): PageMeta => ({
          ref: name,
          tag: "page",
          _isAspiring: true,
          name: name,
          created: "", // Aspiring pages don't have timestamps yet
          lastModified: "", // Aspiring pages don't have timestamps yet
          perm: "rw",
        })),
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
        this.flashNotification(
          "Could not fetch page list directly.",
          "error",
        );
      }
    }

    this.ui.viewDispatch({
      type: "update-page-list",
      allPages: allPages,
    });
  }

  async updateDocumentListCache() {
    console.log("Updating document list cache");
    if (!this.clientSystem.system.loadedPlugs.has("index")) {
      console.warn("Index plug not loaded, won't update document list cache");
      return;
    }

    const allDocuments = await this.clientSystem.queryLuaObjects<DocumentMeta>(
      "document",
      {},
    );

    this.ui.viewDispatch({
      type: "update-document-list",
      allDocuments: allDocuments,
    });
  }

  showProgress(progressPercentage?: number, progressType?: "sync" | "index") {
    this.ui.viewDispatch({
      type: "set-progress",
      progressPercentage,
      progressType,
    });
    if (this.progressTimeout) {
      clearTimeout(this.progressTimeout);
    }
    this.progressTimeout = setTimeout(
      () => {
        this.ui.viewDispatch({
          type: "set-progress",
        });
      },
      5000,
    );
  }

  // Various UI elements
  filterBox(
    label: string,
    options: FilterOption[],
    helpText = "",
    placeHolder = "",
  ): Promise<FilterOption | undefined> {
    return new Promise((resolve) => {
      this.ui.viewDispatch({
        type: "show-filterbox",
        label,
        options,
        placeHolder,
        helpText,
        onSelect: (option: any) => {
          this.ui.viewDispatch({ type: "hide-filterbox" });
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
      this.ui.viewDispatch({
        type: "show-prompt",
        message,
        defaultValue,
        callback: (value: string | undefined) => {
          this.ui.viewDispatch({ type: "hide-prompt" });
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
      this.ui.viewDispatch({
        type: "show-confirm",
        message,
        callback: (value: boolean) => {
          this.ui.viewDispatch({ type: "hide-confirm" });
          this.focus();
          resolve(value);
        },
      });
    });
  }

  async loadPlugs() {
    await this.clientSystem.reloadPlugsFromSpace(this.space);
    await this.dispatchAppEvent("plugs:loaded");
  }

  rebuildEditorState() {
    const editorView = this.editorView;

    editorView.setState(
      createEditorState(
        this,
        this.currentName(),
        editorView.state.sliceDoc(),
        this.ui.viewState.current?.meta.perm === "ro",
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

  public extractParentNodes(editorState: EditorState, currentNode: SyntaxNode) {
    const parentNodes: string[] = [];
    if (currentNode) {
      let node: SyntaxNode | null = currentNode;
      do {
        if (node.name === "FencedCode" || node.name === "FrontMatter") {
          const body = editorState.sliceDoc(node.from + 3, node.to - 3);
          parentNodes.push(`${node.name}:${body}`);
        } else {
          parentNodes.push(node.name);
        }
        node = node.parent;
      } while (node);
    }
    return parentNodes;
  }

  editorComplete(
    context: CompletionContext,
  ): Promise<CompletionResult | null> {
    return this.completeWithEvent(context, "editor:complete") as Promise<
      CompletionResult | null
    >;
  }

  miniEditorComplete(
    context: CompletionContext,
  ): Promise<CompletionResult | null> {
    return this.completeWithEvent(context, "minieditor:complete") as Promise<
      CompletionResult | null
    >;
  }

  async reloadEditor() {
    if (!this.systemReady) return;

    console.log("Reloading editor");
    clearTimeout(this.saveTimeout);

    try {
      if (isMarkdownPath(this.currentPath())) {
        await this.loadPage(this.currentPath());
      } else {
        await this.loadDocumentEditor(this.currentPath());
      }
    } catch {
      console.log(this.currentPath());
      console.error("There was an error during reload");
    }
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

    if (this.isDocumentEditor()) {
      this.documentEditor.focus();
    } else {
      this.editorView.focus();
    }
  }

  getIndexRef(): Ref {
    return parseToRef(this.clientConfig.indexPage) || { path: "index.md" };
  }

  async navigate(
    ref: Ref | null,
    replaceState = false,
    newWindow = false,
  ) {
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

    await this.pageNavigator!.navigate(
      ref,
      replaceState,
    );
    this.focus();
  }

  async loadDocumentEditor(path: Path) {
    if (isMarkdownPath(path)) throw Error("This is a markdown path");

    const previousPath = this.ui.viewState.current?.path;
    const loadingDifferentPath = previousPath
      ? (previousPath !== path)
      // Always load as different editor if editor is loaded from scratch
      : true;

    if (previousPath) {
      this.space.unwatchFile(previousPath);
      await this.save(true);
    }

    // This can throw, but that will be catched and handled upstream.
    const doc = await this.space.readDocument(path);

    // Create the document editor if it doesn't already exist
    if (
      !this.isDocumentEditor() ||
      this.documentEditor.extension !== doc.meta.extension
    ) {
      try {
        await this.switchToDocumentEditor(doc.meta.extension);
      } catch (e: any) {
        // If there is no document editor we will open the file raw
        if (e.message.includes("Couldn't find")) {
          this.openUrl(fsEndpoint + "/" + path, !previousPath);
        }

        throw e;
      }

      if (!this.isDocumentEditor()) {
        throw new Error("Problem setting up document editor");
      }
    }

    if (!loadingDifferentPath) {
      // We are loading the same page again so just send a file changed event.
      // This can e.g. after a sync found changes elsewhere
      await this.documentEditor.changeContent(doc.data, doc.meta);
    } else {
      this.documentEditor!.setContent(doc.data, doc.meta);
    }

    this.space.watchFile(path);

    this.ui.viewDispatch({
      type: "document-editor-loaded",
      meta: doc.meta,
      path: path,
    });

    this.eventHook.dispatchEvent(
      loadingDifferentPath
        ? "editor:documentLoaded"
        : "editor:documentReloaded",
      path,
      previousPath,
    ).catch(console.error);
  }

  async loadPage(path: Path) {
    if (!isMarkdownPath(path)) throw Error("This is not a markdown path");

    const previousPath = this.ui.viewState.current?.path;
    const loadingDifferentPath = previousPath
      ? (previousPath !== path)
      // Always load as different page if page is loaded from scratch
      : true;
    const pageName = getNameFromPath(path);

    if (previousPath) {
      this.space.unwatchFile(previousPath);
      await this.save(true);
    }

    // Fetch next page to open
    let doc;
    try {
      doc = await this.space.readPage(pageName);
    } catch (e: any) {
      if (!e.message.includes("Not found")) {
        throw e;
      }

      console.log(`Page doesn't exist, creating new page: ${pageName}`);

      // Mock up the page. We won't yet safe it, because the user may not even
      // want to create that page
      doc = {
        text: "",
        meta: {
          ref: pageName,
          tags: ["page"],
          name: pageName,
          lastModified: "",
          created: "",
          perm: "rw",
        } as PageMeta,
      };

      // Let's dispatch a editor:pageCreating event to see if anybody wants to do something before the page is created
      const results = await this.dispatchAppEvent(
        "editor:pageCreating",
        { name: pageName } as PageCreatingEvent,
      ) as PageCreatingContent[];

      if (results.length === 1) {
        doc.text = results[0].text;
        doc.meta.perm = results[0].perm;
      } else if (results.length > 1) {
        console.error(
          "Multiple responses for editor:pageCreating event, this is not supported",
        );
      }
    }

    // This could create an invalid editor state, but that doesn't matter, we'll update it later
    this.switchToPageEditor();

    this.ui.viewDispatch({
      type: "page-loaded",
      meta: doc.meta,
      path: path,
    });

    // Fetch the meta which includes the possibly indexed stuff, like page
    // decorations
    if (await this.hasInitialSyncCompleted()) {
      try {
        const enrichedMeta = await this.clientSystem.getObjectByRef<PageMeta>(
          pageName,
          "page",
          pageName,
        ) ?? doc.meta;

        const body = document.body;
        body.removeAttribute("class");

        if (enrichedMeta.pageDecoration?.cssClasses) {
          body.className = enrichedMeta.pageDecoration.cssClasses
            .join(" ")
            .replaceAll(/[^a-zA-Z0-9-_ ]/g, "");
        }

        this.ui.viewDispatch({
          type: "update-current-page-meta",
          meta: enrichedMeta,
        });
      } catch (e: any) {
        console.log(
          `There was an error trying to fetch enriched metadata: ${e.message}`,
        );
      }
    }

    // When loading a different page OR if the page is read-only (in which case we don't want to apply local patches, because there's no point)
    if (loadingDifferentPath || doc.meta.perm === "ro") {
      const editorState = createEditorState(
        this,
        pageName,
        doc.text,
        doc.meta.perm === "ro",
      );
      this.editorView.setState(editorState);
    } else {
      // Just apply minimal patches so that the cursor is preserved
      this.setEditorText(doc.text, true);
    }

    this.space.watchFile(path);

    // Note: these events are dispatched asynchronously deliberately (not waiting for results)
    this.eventHook.dispatchEvent(
      loadingDifferentPath ? "editor:pageLoaded" : "editor:pageReloaded",
      pageName,
      previousPath ? getNameFromPath(previousPath) : undefined,
    ).catch(console.error);
  }

  isDocumentEditor(): this is { documentEditor: DocumentEditor } & this {
    return this.documentEditor !== null;
  }

  switchToPageEditor() {
    if (!this.isDocumentEditor()) return;

    // Deliberately not awaiting this function as destroying & last-save can be handled in the background
    this.documentEditor.destroy();
    // @ts-ignore: This is there the hacked type-guard from isDocumentEditor fails
    this.documentEditor = null;

    this.rebuildEditorState();

    document.getElementById("sb-editor")!.classList.remove("hide-cm");
  }

  async switchToDocumentEditor(extension: string) {
    if (this.documentEditor) {
      // Deliberately not awaiting this function as destroying & last-save can be handled in the background
      this.documentEditor.destroy();
    }

    // This is probably not the best way to hide the codemirror editor, but it works
    document.getElementById("sb-editor")!.classList.add("hide-cm");

    this.documentEditor = new DocumentEditor(
      document.getElementById("sb-editor")!,
      this,
      (path, content) => {
        this.space
          .writeDocument(path, content, true)
          .then(async (meta) => {
            this.ui.viewDispatch({ type: "document-editor-saved" });

            await this.dispatchAppEvent(
              "editor:documentSaved",
              path,
              meta,
            );
          })
          .catch(() => {
            this.flashNotification(
              "Could not save document, retrying again in 10 seconds",
              "error",
            );
            this.saveTimeout = setTimeout(this.save.bind(this), 10000);
          });
      },
    );

    await this.documentEditor.init(extension);

    // We have to rebuild the editor state here to update the keymap correctly
    // This is a little hacky but any other solution would pose a larger rewrite
    this.rebuildEditorState();
    this.editorView.contentDOM.blur();
  }

  setEditorText(newText: string, shouldIsolateHistory = false) {
    const currentText = this.editorView.state.sliceDoc();
    const allChanges = diffAndPrepareChanges(currentText, newText);
    client.editorView.dispatch({
      changes: allChanges,
      annotations: shouldIsolateHistory ? isolateHistory.of("full") : undefined,
    });
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
    if (this.clientConfig.disableSpaceStyle) {
      console.warn("Not loading custom styles, since space style is disabled");
      return;
    }
    if (!await this.hasInitialSyncCompleted()) {
      console.info(
        "Not loading custom styles yet, since initial synca has not completed yet",
      );
      return;
    }

    const spaceStyles = await this.clientSystem.queryLuaObjects<StyleObject>(
      "space-style",
      {
        objectVariable: "_",
        orderBy: [{
          expr: parseExpressionString("_.priority"),
          desc: true,
        }],
      },
    );
    if (!spaceStyles) {
      return;
    }

    // Prepare separate <style> tag per custom style (for robustness)
    const customStylesContent = spaceStyles.map((s) =>
      "<style>" + s.style + "</style>"
    ).join("\n\n");
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

  getCommandsByContext(
    state: AppViewState,
  ): Map<string, Command> {
    const currentEditor = client.documentEditor?.name;
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

  async loadCaches() {
    const [widgetHeightCache, widgetCache] = await this
      .ds.batchGet([[
        "cache",
        "widgetHeight",
      ], ["cache", "widgets"]]);
    this.widgetHeightCache = new LimitedMap(100, widgetHeightCache || {});
    this.widgetCache = new LimitedMap(100, widgetCache || {});
  }

  setCachedWidgetHeight(bodyText: string, height: number) {
    this.widgetHeightCache.set(bodyText, height);
    this.debouncedWidgetHeightCacheFlush();
  }

  getCachedWidgetHeight(bodyText: string): number {
    return this.widgetHeightCache.get(bodyText) ?? -1;
  }

  setWidgetCache(key: string, cacheItem: WidgetCacheItem) {
    this.widgetCache.set(key, cacheItem);
    this.debouncedWidgetCacheFlush();
  }

  getWidgetCache(key: string): WidgetCacheItem | undefined {
    return this.widgetCache.get(key);
  }

  private async initSync() {
    this.syncService.start();

    // We're still booting, if a initial sync has already been completed we know this is the initial sync
    let initialSync = !await this.hasInitialSyncCompleted();

    this.eventHook.addLocalListener("sync:success", async (operations) => {
      if (operations > 0) {
        // Update the page list
        await this.space.updatePageList();
      }
      if (operations !== undefined) {
        // "sync:success" is called with a number of operations only from syncSpace(), not from syncing individual pages
        this.fullSyncCompleted = true;

        console.log("[sync]", "Full sync completed");

        // A full sync just completed
        if (!initialSync) {
          // If this was NOT the initial sync let's check if we need to perform a space reindex
          this.clientSystem.ensureFullIndex().catch(
            console.error,
          );
        } else { // initialSync
          console.log(
            "[sync]",
            "Initial sync completed, now need to do a full space index to ensure all pages are indexed using any custom indexers",
          );
          this.eventedSpacePrimitives.enablePageEvents = true;
          this.clientSystem.ensureFullIndex().catch(
            console.error,
          );
          initialSync = false;
        }
      }
      if (operations) {
        // Likely initial sync so let's show visually that we're synced now
        this.showProgress(100, "sync");
      }

      this.ui.viewDispatch({ type: "sync-change", syncSuccess: true });
    });

    this.eventHook.addLocalListener("sync:error", (_name) => {
      this.ui.viewDispatch({ type: "sync-change", syncSuccess: false });
    });

    this.eventHook.addLocalListener("sync:conflict", (name) => {
      this.flashNotification(
        `Sync: conflict detected for ${name} - conflict copy created`,
        "error",
      );
    });

    this.eventHook.addLocalListener("sync:progress", (status: SyncStatus) => {
      this.showProgress(
        Math.round(status.filesProcessed / status.totalFiles * 100),
        "sync",
      );
    });

    this.eventHook.addLocalListener(
      "file:synced",
      (meta: FileMeta, direction: string) => {
        if (direction === "secondary->primary") {
          // We likely polled the currently open page or document which triggered a local update, let's update the editor accordingly
          this.space.spacePrimitives.getFileMeta(meta.name);
        }
      },
    );
  }

  private navigateWithinPage(pageState: LocationState) {
    if (!isMarkdownPath(pageState.path)) return;

    // We can't use getOffsetFromRef here, because it is asyncronous.
    let pos: number | undefined = undefined;

    // Don't use getOffsetFromRef, so we can show error messages
    if (pageState.details?.type === "header") {
      const pageText = this.editorView.state.sliceDoc();

      pos = getOffsetFromHeader(
        parseMarkdown(pageText),
        pageState.details.header,
      );

      if (pos === -1) {
        this.flashNotification(
          `Could not find header "${pageState.details.header}"`,
          "error",
        );

        pos = undefined;
      }
    } else if (pageState.details?.type === "position") {
      pos = Math.max(
        0,
        Math.min(pageState.details.pos, this.editorView.state.doc.length),
      );
    } else if (pageState.details?.type === "linecolumn") {
      const pageText = this.editorView.state.sliceDoc();

      pos = getOffsetFromLineColumn(
        pageText,
        pageState.details.line,
        pageState.details.column,
      );
    }

    if (pos !== undefined) {
      this.editorView.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, {
          y: "start",
          yMargin: 5,
        }),
      });

      // If a position was specified, we bail out and ignore any cached state
      return;
    }

    let adjustedPosition = false;

    // Was a particular scroll position persisted?
    if (pageState.scrollTop && pageState.scrollTop > 0) {
      setTimeout(() => {
        this.editorView.scrollDOM.scrollTop = pageState.scrollTop!;
      });
      adjustedPosition = true;
    }

    // Was a particular cursor/selection set?
    if (pageState.selection?.anchor) {
      this.editorView.dispatch({
        selection: pageState.selection,
      });
      adjustedPosition = true;
    }

    // If not: just put the cursor at the top of the page, right after the frontmatter
    if (!adjustedPosition) {
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
  }

  private async initNavigator() {
    this.pageNavigator = new PathPageNavigator(this);

    this.pageNavigator.subscribe(async (locationState) => {
      console.log(`Now navigating to ${encodeRef(locationState)}`);

      if (isMarkdownPath(locationState.path)) {
        await this.loadPage(locationState.path);
      } else {
        await this.loadDocumentEditor(locationState.path);
      }

      // Setup scroll position, cursor position, etc
      try {
        this.navigateWithinPage(locationState);
      } catch {
        // We don't really care if this fails.
      }

      // Persist this page as the last opened page, we'll use this for cold start PWA loads
      await this.ds.set(
        ["client", "lastOpenedPath"],
        locationState.path,
      );
    });

    // Initial navigation
    let ref = this.onLoadRef;

    if (ref.details?.type === "header" && ref.details.header === "boot") {
      const path = await this.ds.get(
        ["client", "lastOpenedPath"],
      ) as Path;

      console.log("Navigating to last opened page", getNameFromPath(path));
      ref = { path };
    }

    await this.navigate(ref, true);

    console.log("Focusing editor");
    this.focus();
  }

  async wipeClient() {
    if (navigator.serviceWorker) {
      // We will attempt to unregister the service worker, best effort
      console.log("Getting service worker registrations");
      navigator.serviceWorker.getRegistrations().then(
        async (registrations) => {
          for (const registration of registrations) {
            await registration.unregister();
          }
          console.log("Unregistered all service workers");
        },
      );
    } else {
      console.info(
        "Service workers not enabled (no HTTPS?), so not unregistering.",
      );
    }
    console.log("Stopping all systems");
    this.space.unwatch();
    this.syncService.close();

    console.log("Clearing data store");
    await this.ds.kv.clear();
    console.log("Clearing complete.");
  }
}

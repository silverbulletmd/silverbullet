import { EditorView } from "@codemirror/view";
import type { ChangeSet, Text } from "@codemirror/state";
import { isolateHistory } from "@codemirror/commands";
import { throttle } from "@silverbulletmd/silverbullet/lib/async";
import {
  getNameFromPath,
  getOffsetFromHeader,
  getOffsetFromLineColumn,
  getPathExtension,
  isMarkdownPath,
  type Path,
} from "@silverbulletmd/silverbullet/lib/ref";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import type {
  PageCreatingContent,
  PageCreatingEvent,
} from "@silverbulletmd/silverbullet/type/event";
import { notFoundError } from "@silverbulletmd/silverbullet/constants";
import {
  createEditorState,
  externalUpdate,
  forceParseVisibleRegion,
} from "./codemirror/editor_state.ts";
import { externalSource } from "./codemirror/external_presence.ts";
import { diffAndPrepareChanges } from "./codemirror/cm_util.ts";
import {
  type ConflictHunk,
  findConflictHunks,
} from "./codemirror/conflict_markers.ts";
import { computeExternalChanges } from "./external_merge.ts";
import { parsePageMetaLastModified } from "./lib/page_meta.ts";
import { DocumentEditor } from "./document_editor.ts";
import { fsEndpoint } from "./spaces/constants.ts";
import { PermissionDeniedError } from "./spaces/http_space_primitives.ts";
import { parseMarkdown } from "./markdown_parser/parser.ts";
import type { Client } from "./client.ts";
import type { LocationState } from "./navigator.ts";

const frontMatterRegex = /^---\n(([^\n]|\n)*?)---\n/;

/** The conflict hunk the selection head sits in, if any. */
function selectionHunk(state: {
  doc: Text;
  selection: { main: { head: number } };
}): ConflictHunk | undefined {
  const head = state.selection.main.head;
  return findConflictHunks(state.doc).find(
    (h) => head >= h.from && head <= h.to,
  );
}

const autoSaveInterval = 1000;

/**
 * Manages content lifecycle: loading, saving, reloading, and editor mode switching
 * for both markdown pages and non-markdown documents.
 */
export class ContentManager {
  documentEditor: DocumentEditor | null = null;
  saveTimeout?: ReturnType<typeof setTimeout>;
  private scrollRestoreCleanup?: () => void;
  // Last content known to be on disk (base for 3-way external merges)
  private lastKnownDiskText = "";
  // lastModified backing lastKnownDiskText, used to reject an apply whose
  // fetched content is older than what's already applied (out-of-order
  // resolution of overlapping reloads for the same page)
  private lastKnownDiskModified?: number;
  // An external update computeExternalChanges withheld because it collided
  // with unsaved local edits. The base above deliberately stays put while
  // this is set: the buffer still descends from it, not from the withheld
  // revision.
  private pendingExternal?: {
    text: string;
    modified: number | undefined;
    source: string;
  };
  // Resolves once the in-flight write has updated the base above
  private pendingWrite?: Promise<void>;
  debouncedUpdateEvent = throttle(() => {
    this.client.eventHook
      .dispatchEvent("editor:updated")
      .catch((e) => console.error("Error dispatching editor:updated event", e));
  }, 1000);

  constructor(private client: Client) {}

  // Save the current page or document
  save(immediate = false): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.saveTimeout) {
        clearTimeout(this.saveTimeout);
      }
      this.saveTimeout = setTimeout(
        async () => {
          if (
            !this.client.ui.viewState.unsavedChanges ||
            this.client.isReadOnlyMode()
          ) {
            return resolve();
          }

          if (this.isDocumentEditor()) {
            console.log(
              "Requesting save for document",
              this.client.currentPath(),
            );
            void this.client.dispatchAppEvent(
              "editor:documentSaving",
              this.client.currentPath(),
            );

            this.documentEditor.requestSave();

            return resolve();
          } else {
            if (this.client.editorView.composing) {
              this.saveTimeout = setTimeout(
                this.save.bind(this),
                autoSaveInterval,
              );
              return resolve();
            }

            // Captured before the await below: clearTimeout can't cancel a
            // callback that already suspended, so without pinning these a
            // save resuming after a navigation would write this buffer under
            // the *next* page's name.
            const path = this.client.currentPath();
            const pageName = getNameFromPath(path);

            const divergentBase = this.settlePendingExternal();
            if (divergentBase !== undefined) {
              await this.client
                .declareDivergentBase(path, divergentBase)
                .catch((e) =>
                  console.error("Could not declare divergent base", e),
                );
              if (this.client.currentPath() !== path) {
                console.log("Page changed while saving, dropping write", path);
                return resolve();
              }
            }

            console.log("Saving page", path);
            void this.client.dispatchAppEvent("editor:pageSaving", pageName);
            const text = this.client.editorView.state.sliceDoc(0);
            const writePromise = this.client.space.writePage(pageName, text);
            // Separate from the promise save() returns: waiters need the base
            // updated, not the events and meta fetch that follow it.
            const baseUpdated = writePromise.then(
              (meta) =>
                this.adoptOwnWriteAsBase(
                  text,
                  parsePageMetaLastModified(meta.lastModified),
                ),
              () => {}, // errors are reported by the .catch() below
            );
            this.pendingWrite = baseUpdated;
            void baseUpdated.then(() => {
              if (this.pendingWrite === baseUpdated) {
                this.pendingWrite = undefined;
              }
            });
            writePromise
              .then(async (meta) => {
                this.client.ui.viewDispatch({ type: "page-saved" });
                await this.client.dispatchAppEvent(
                  "editor:pageSaved",
                  this.client.currentName(),
                  meta,
                );

                resolve();

                const enrichedMeta =
                  await this.client.objectIndex.getObjectByRef(
                    this.client.currentName(),
                    "page",
                    this.client.currentName(),
                  );
                if (enrichedMeta) {
                  this.client.ui.viewDispatch({
                    type: "update-current-page-meta",
                    meta: enrichedMeta,
                  });

                  if (!this.client.editorView.composing) {
                    // Trigger editor re-render to update Lua widgets
                    // with the new metadata
                    this.client.editorView.dispatch({});
                  }
                }
              })
              .catch((e) => {
                if (e instanceof PermissionDeniedError) {
                  this.client.ui.flashNotification(
                    "You have read-only access to this space",
                    "error",
                  );
                  reject(e);
                  return;
                }
                this.client.ui.flashNotification(
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

  /**
   * Records the text we just wrote as the new base, unless a newer state was
   * adopted while this write was in flight: dragging the base backwards would
   * make the next merge apply that newer change a second time.
   */
  private adoptOwnWriteAsBase(text: string, modified: number | undefined) {
    if (
      modified !== undefined &&
      this.lastKnownDiskModified !== undefined &&
      modified < this.lastKnownDiskModified
    ) {
      return;
    }
    this.lastKnownDiskText = text;
    this.lastKnownDiskModified = modified;
  }

  async reloadEditor() {
    if (!this.client.systemReady) return;

    console.log("Reloading editor");
    clearTimeout(this.saveTimeout);

    try {
      if (isMarkdownPath(this.client.currentPath())) {
        await this.loadPage({ path: this.client.currentPath() }, false);
      } else {
        await this.loadDocumentEditor({ path: this.client.currentPath() });
      }
    } catch {
      console.log(this.client.currentPath());
      console.error("There was an error during reload");
    }
  }

  /**
   * Cleanly leave the current page/document before navigating to a new one:
   * unwatches the file, saves pending changes, and waits for index processing.
   * Returns { previousPath, loadingDifferentPath }.
   */
  private async leaveCurrentPage(newPath: string) {
    const previousPath = this.client.ui.viewState.current?.path;
    const loadingDifferentPath = previousPath ? previousPath !== newPath : true;

    if (previousPath) {
      await this.save(true);
      // Wait briefly for saved-page indexing so widgets see fresh data. Skip
      // initial indexing and cap the wait to keep navigation responsive.
      if (await this.client.objectIndex.hasFullIndexCompleted()) {
        await Promise.race([
          this.client.objectIndex.awaitIndexQueueDrain(),
          new Promise<void>((resolve) => setTimeout(resolve, 2000)),
        ]);
      }
    }

    if (loadingDifferentPath) {
      // Drop session prewarmed widget results: iframe widgets key prewarms
      // by bodyText alone, so without this the next page would reuse the
      // previous page's query results.
      this.client.widgetCache.clearPrewarm();
    }

    return { previousPath, loadingDifferentPath };
  }

  async loadDocumentEditor(locationState: LocationState) {
    const path = locationState.path;
    if (isMarkdownPath(path)) throw Error("This is a markdown path");

    const { previousPath, loadingDifferentPath } =
      await this.leaveCurrentPage(path);

    const extension = getPathExtension(path as Path);
    const needsEditorSwitch =
      !this.isDocumentEditor() || this.documentEditor.extension !== extension;
    if (
      needsEditorSwitch &&
      !Array.from(
        this.client.clientSystem.documentEditorHook.documentEditors.values(),
      ).some(({ extensions }) => extensions.includes(extension))
    ) {
      this.client.openUrl(
        `${document.baseURI.replace(/\/*$/, "") + fsEndpoint}/${path}`,
      );
      throw new Error("Opened externally");
    }
    const doc = await this.client.space.readDocument(path);

    if (needsEditorSwitch) {
      try {
        await this.switchToDocumentEditor(extension);
      } catch (e: any) {
        if (e.message.includes("Couldn't find")) {
          this.client.openUrl(
            `${document.baseURI.replace(/\/*$/, "") + fsEndpoint}/${path}`,
          );
          throw new Error("Opened externally");
        }

        throw e;
      }

      if (!this.isDocumentEditor()) {
        throw new Error("Problem setting up document editor");
      }
    }

    this.documentEditor!.openFile(doc.data, doc.meta, locationState.details);

    if (previousPath) this.client.space.unwatchFile(previousPath);
    this.client.space.watchFile(path);

    this.client.ui.viewDispatch({
      type: "document-editor-loaded",
      meta: doc.meta,
      path: path,
    });

    this.client.eventHook
      .dispatchEvent(
        loadingDifferentPath
          ? "editor:documentLoaded"
          : "editor:documentReloaded",
        path,
        previousPath,
      )
      .catch(console.error);
  }

  async loadPage(
    locationState: LocationState,
    navigateWithinPage: boolean = true,
  ) {
    const path = locationState.path;
    if (!isMarkdownPath(path)) throw Error("This is not a markdown path");

    const { previousPath, loadingDifferentPath } =
      await this.leaveCurrentPage(path);
    const pageName = getNameFromPath(path);

    let doc;
    let markerIndex = -1;
    try {
      doc = await this.client.space.readPage(pageName);
    } catch (e: any) {
      if (e.message !== notFoundError.message) {
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

      const results = (await this.client.dispatchAppEvent(
        "editor:pageCreating",
        {
          name: pageName,
        } as PageCreatingEvent,
      )) as PageCreatingContent[];

      if (results.length === 1) {
        doc.text = results[0].text;
        doc.meta.perm = results[0].perm;
        const cursorMarker = "|^|";
        const idx = doc.text.indexOf(cursorMarker);
        if (idx !== -1) {
          markerIndex = idx;
          doc.text =
            doc.text.slice(0, idx) + doc.text.slice(idx + cursorMarker.length);
        }
      } else if (results.length > 1) {
        console.error(
          "Multiple responses for editor:pageCreating event, this is not supported",
        );
      }
    }

    // This could create an invalid editor state, but that doesn't matter, we'll update it later
    this.switchToPageEditor();

    // Record last-opened time best-effort and non-blocking: this is a write
    // to the shared index store, and awaiting it would stall navigation
    // behind an in-progress reindex for no user-visible benefit.
    void this.client.pageMetaAugmenter
      .setAugmentation(pageName, { lastOpened: Date.now() })
      .catch((e) =>
        console.warn("Could not record lastOpened for", pageName, e),
      );

    this.client.ui.viewDispatch({
      type: "page-loaded",
      meta: doc.meta,
      path: path,
    });

    await this.refreshCurrentPageMeta(pageName, doc.meta);

    if (loadingDifferentPath || doc.meta.perm === "ro") {
      // Fresh state, nothing to diff against yet: doc.text *is* the new base.
      this.pendingExternal = undefined;
      this.lastKnownDiskText = doc.text;
      this.lastKnownDiskModified = parsePageMetaLastModified(
        doc.meta.lastModified,
      );
      const editorState = createEditorState(
        this.client,
        pageName,
        doc.text,
        doc.meta.perm === "ro",
      );
      this.client.editorView.setState(editorState);
      performance.mark("sb:page-content");
    } else {
      // Same-page reload: applyExternalPatches diffs against the base from
      // the *previous* load (this.lastKnownDiskText, untouched above) and
      // updates it to doc.text itself.
      this.applyExternalPatches(
        doc.text,
        parsePageMetaLastModified(doc.meta.lastModified),
      );
    }

    if (previousPath) this.client.space.unwatchFile(previousPath);
    this.client.space.watchFile(path);

    if (navigateWithinPage) {
      try {
        this.navigateWithinPage(locationState);
      } catch {}
    }

    forceParseVisibleRegion(this.client.editorView, locationState.scrollTop);
    // Note: these events are dispatched asynchronously deliberately (not waiting for results)
    this.client.eventHook
      .dispatchEvent(
        loadingDifferentPath ? "editor:pageLoaded" : "editor:pageReloaded",
        pageName,
        previousPath ? getNameFromPath(previousPath) : undefined,
      )
      .catch(console.error);

    // If a cursor marker was found for a newly-created page, place the
    // cursor there now (after navigateWithinPage so it doesn't get
    // overwritten by default positioning).
    if (markerIndex !== -1) {
      try {
        const pos = Math.max(
          0,
          Math.min(markerIndex, this.client.editorView.state.doc.length),
        );
        this.client.editorView.dispatch({
          selection: { anchor: pos },
          effects: [EditorView.scrollIntoView(pos, { y: "center" })],
        });
        this.client.editorView.focus();
      } catch (e) {
        console.error("Failed to set cursor at cursor marker:", e);
      }
    }
  }

  isDocumentEditor(): this is { documentEditor: DocumentEditor } & this {
    return this.documentEditor !== null;
  }

  switchToPageEditor() {
    if (!this.isDocumentEditor()) return;

    // Deliberately not awaiting this function as destroying & last-save can be handled in the background
    this.documentEditor.destroy();
    // @ts-expect-error: This is there the hacked type-guard from isDocumentEditor fails
    this.documentEditor = null;

    this.client.rebuildEditorState();

    document.getElementById("sb-editor")!.classList.remove("hide-cm");
  }

  async switchToDocumentEditor(extension: string) {
    if (this.documentEditor) {
      // Deliberately not awaiting this function as destroying & last-save can be handled in the background
      this.documentEditor.destroy();
    }

    document.getElementById("sb-editor")!.classList.add("hide-cm");

    this.documentEditor = new DocumentEditor(
      document.getElementById("sb-editor")!,
      this.client,
      (path, content) => {
        this.client.space
          .writeDocument(path, content)
          .then(async (meta) => {
            this.client.ui.viewDispatch({ type: "document-editor-saved" });

            await this.client.dispatchAppEvent(
              "editor:documentSaved",
              path,
              meta,
            );
          })
          .catch(() => {
            this.client.ui.flashNotification(
              "Could not save document, retrying again in 10 seconds",
              "error",
            );
            this.saveTimeout = setTimeout(this.save.bind(this), 10000);
          });
      },
    );

    await this.documentEditor.init(extension);

    // We have to rebuild the editor state here to update the keymap correctly
    this.client.rebuildEditorState();
    this.client.editorView.contentDOM.blur();
  }

  setEditorText(newText: string, shouldIsolateHistory = false) {
    const currentText = this.client.editorView.state.sliceDoc();
    const allChanges = diffAndPrepareChanges(currentText, newText);
    this.client.editorView.dispatch({
      changes: allChanges,
      annotations: shouldIsolateHistory ? isolateHistory.of("full") : undefined,
    });
  }

  // Applies an external (storage-side) content change as a minimal,
  // cursor-preserving transaction: a 3-way merge against the last known
  // on-disk text so unsaved local edits survive. The transaction is marked
  // externalUpdate (skips the save-on-change handler) and isolated in undo
  // history, so a single undo reverts exactly this external change.
  // Returns whether a change was actually dispatched, so callers can skip
  // follow-up work (meta refresh, notifications) for a dropped/no-op apply.
  private applyExternalPatches(
    newText: string,
    modified: number | undefined,
    source = "external",
  ): boolean {
    // A withheld update is newer than the base, so it -- not the base -- is
    // the high-water mark while one is outstanding.
    const seenModified =
      this.pendingExternal?.modified ?? this.lastKnownDiskModified;
    if (
      modified !== undefined &&
      seenModified !== undefined &&
      modified < seenModified
    ) {
      // Two reloads for this page were in flight and this older one resolved
      // last (e.g. a direct reloadEditor racing an SSE-triggered
      // reloadPageContent). Applying it would revert already-applied,
      // newer content.
      console.log(
        "Dropping stale external patch, older than already-applied content",
        { source, modified, seenModified },
      );
      return false;
    }
    const currentText = this.client.editorView.state.sliceDoc();
    const { changes, deferred } = computeExternalChanges(
      this.lastKnownDiskText,
      newText,
      currentText,
      { canDefer: this.client.canDeferExternalUpdate() },
    );
    if (deferred) {
      this.pendingExternal = { text: newText, modified, source };
      return false;
    }
    this.pendingExternal = undefined;
    this.lastKnownDiskText = newText;
    this.lastKnownDiskModified = modified;
    if (changes.empty) {
      return false;
    }
    this.dispatchExternal(changes, source);
    return true;
  }

  private dispatchExternal(changes: ChangeSet, source: string) {
    const view = this.client.editorView;
    const hadCursorInHunk = selectionHunk(view.state);
    view.dispatch({
      changes,
      annotations: [
        isolateHistory.of("full"),
        externalUpdate.of(true),
        externalSource.of(source),
      ],
    });
    if (!hadCursorInHunk) {
      const hunk = selectionHunk(view.state);
      if (hunk) {
        // The widget-vs-source check treats both hunk bounds as inclusive,
        // so the cursor must land strictly past the hunk (or before it when
        // the hunk runs to the end of the document).
        const docLen = view.state.doc.length;
        const anchor =
          hunk.to + 1 <= docLen ? hunk.to + 1 : Math.max(hunk.from - 1, 0);
        view.dispatch({
          selection: { anchor },
          scrollIntoView: true,
        });
      }
    }
  }

  /**
   * Re-attempts an external update withheld earlier, right before the buffer
   * is written. The retry is what resolves the common case: by save time the
   * local edit has often moved off the contested line, and the update then
   * merges in cleanly instead of costing a round trip through the server.
   *
   * Returns the revision the buffer still descends from when the collision
   * persists, for SyncEngine.declareDivergentBase to reconcile the write
   * against.
   */
  private settlePendingExternal(): string | undefined {
    const pending = this.pendingExternal;
    if (!pending) {
      return undefined;
    }
    // Cleared either way: after the write the base moves to what was written,
    // which leaves this text with no common ancestor to be merged against.
    this.pendingExternal = undefined;
    const base = this.lastKnownDiskText;
    const { changes, deferred } = computeExternalChanges(
      base,
      pending.text,
      this.client.editorView.state.sliceDoc(),
      { canDefer: this.client.canDeferExternalUpdate() },
    );
    if (deferred) {
      return base;
    }
    this.lastKnownDiskText = pending.text;
    this.lastKnownDiskModified = pending.modified;
    if (!changes.empty) {
      this.dispatchExternal(changes, pending.source);
    }
    return undefined;
  }

  async reloadPageContent(source = "external"): Promise<void> {
    const path = this.client.currentPath();
    if (!isMarkdownPath(path)) {
      return this.reloadEditor();
    }
    const doc = await this.client.space.readPage(getNameFromPath(path));
    if (this.pendingWrite) {
      await this.pendingWrite;
    }
    // The user may have navigated to a different page while this fetch was
    // in flight. Applying now would diff/merge page-A content against
    // whatever page is currently open -- bail out rather than corrupt it.
    if (this.client.currentPath() !== path) {
      return;
    }
    const pageName = getNameFromPath(path);
    const applied = this.applyExternalPatches(
      doc.text,
      parsePageMetaLastModified(doc.meta.lastModified),
      source,
    );
    if (!applied) {
      return;
    }

    await this.refreshCurrentPageMeta(pageName, doc.meta);

    // Note: dispatched asynchronously deliberately (not waiting for
    // results), matching the full-reload path in loadPage.
    this.client.eventHook
      .dispatchEvent("editor:pageReloaded", pageName, pageName)
      .catch(console.error);
  }

  private async refreshCurrentPageMeta(
    pageName: string,
    fallbackMeta: PageMeta,
  ): Promise<void> {
    if (!(await this.client.objectIndex.hasFullIndexCompleted())) {
      return;
    }
    try {
      const enrichedMeta =
        (await this.client.objectIndex.getObjectByRef(
          pageName,
          "page",
          pageName,
        )) ?? fallbackMeta;

      const body = document.body;
      body.removeAttribute("class");

      if (enrichedMeta.pageDecoration?.cssClasses) {
        body.className = enrichedMeta.pageDecoration.cssClasses
          .join(" ")
          .replaceAll(/[^a-zA-Z0-9-_ ]/g, "");
      }

      this.client.ui.viewDispatch({
        type: "update-current-page-meta",
        meta: enrichedMeta,
      });

      // Trigger editor re-render to update Lua widgets with the new metadata
      this.client.editorView.dispatch({});
    } catch (e: any) {
      console.log(
        `There was an error trying to fetch enriched metadata: ${e.message}`,
      );
    }
  }

  private navigateWithinPage(pageState: LocationState) {
    if (!isMarkdownPath(pageState.path)) return;

    // We can't use getOffsetFromRef here, because it is asyncronous.
    let pos: number | undefined;

    if (pageState.details?.type === "header") {
      const pageText = this.client.editorView.state.sliceDoc();

      pos = getOffsetFromHeader(
        parseMarkdown(pageText),
        pageState.details.header,
      );

      if (pos === -1) {
        this.client.ui.flashNotification(
          `Could not find header "${pageState.details.header}"`,
          "error",
        );

        pos = undefined;
      }
    } else if (pageState.details?.type === "position") {
      pos = Math.max(
        0,
        Math.min(
          pageState.details.pos,
          this.client.editorView.state.doc.length,
        ),
      );
    } else if (pageState.details?.type === "linecolumn") {
      const pageText = this.client.editorView.state.sliceDoc();

      pos = getOffsetFromLineColumn(
        pageText,
        pageState.details.line,
        pageState.details.column,
      );
    }

    if (pos !== undefined) {
      this.client.editorView.dispatch({
        selection: { anchor: pos },
        effects: EditorView.scrollIntoView(pos, {
          y: "start",
          yMargin: 5,
        }),
      });

      return;
    }

    let adjustedPosition = false;

    if (pageState.scrollTop && pageState.scrollTop > 0) {
      this.restoreScrollPosition(pageState.scrollTop);
      adjustedPosition = true;
    }

    if (pageState.selection?.anchor) {
      this.client.editorView.dispatch({
        selection: pageState.selection,
      });
      adjustedPosition = true;
    }

    if (!adjustedPosition && this.scrollRestoreCleanup) {
      this.scrollRestoreCleanup();
      this.scrollRestoreCleanup = undefined;
    }
    if (!adjustedPosition) {
      const pageText = this.client.editorView.state.sliceDoc();

      let initialCursorPos = 0;
      const match = frontMatterRegex.exec(pageText);
      if (match) {
        initialCursorPos = match[0].length;
      }
      this.client.editorView.scrollDOM.scrollTop = 0;
      this.client.editorView.dispatch({
        selection: { anchor: initialCursorPos },
        scrollIntoView: true,
      });
    }
  }

  /**
   * Restores scroll position after page navigation, accounting for async widget
   * rendering that may change the page layout. Uses a MutationObserver to
   * re-apply the scroll position whenever the DOM changes (e.g. widgets finish
   * rendering), with a timeout to stop after the layout has stabilized.
   */
  private restoreScrollPosition(scrollTop: number) {
    if (this.scrollRestoreCleanup) {
      this.scrollRestoreCleanup();
    }

    const scrollDOM = this.client.editorView.scrollDOM;
    let settled = false;

    const applyScroll = () => {
      if (settled) return;
      // Skip no-op writes so the observer below doesn't fight CodeMirror's
      // own scroll-anchoring on widget-unrelated mutations.
      if (scrollDOM.scrollTop !== scrollTop) {
        scrollDOM.scrollTop = scrollTop;
      }
    };

    // Hide the editor until CodeMirror has done its first measure pass: a
    // sync set after setState gets clamped to 0 because scrollHeight isn't
    // established yet, and without hiding the browser paints once at 0.
    scrollDOM.style.visibility = "hidden";
    applyScroll();
    requestAnimationFrame(() => {
      applyScroll();
      scrollDOM.style.visibility = "";
    });

    const observer = new MutationObserver(() => {
      applyScroll();
    });

    observer.observe(scrollDOM, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });

    const onUserScroll = () => {
      cleanup();
    };
    // Delay attaching the scroll listener so our own scroll assignments don't
    // trigger it
    const scrollListenerTimer = setTimeout(() => {
      scrollDOM.addEventListener("scroll", onUserScroll, { once: true });
    }, 100);

    const timeout = setTimeout(() => {
      cleanup();
    }, 2000);

    const cleanup = () => {
      if (settled) return;
      settled = true;
      scrollDOM.style.visibility = "";
      observer.disconnect();
      clearTimeout(timeout);
      clearTimeout(scrollListenerTimer);
      scrollDOM.removeEventListener("scroll", onUserScroll);
      if (this.scrollRestoreCleanup === cleanup) {
        this.scrollRestoreCleanup = undefined;
      }
    };

    this.scrollRestoreCleanup = cleanup;
  }
}

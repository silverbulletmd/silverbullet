import { EditorView } from "@codemirror/view";
import { isolateHistory } from "@codemirror/commands";
import { throttle } from "@silverbulletmd/silverbullet/lib/async";
import {
  getNameFromPath,
  getOffsetFromHeader,
  getOffsetFromLineColumn,
  isMarkdownPath,
} from "@silverbulletmd/silverbullet/lib/ref";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import type {
  PageCreatingContent,
  PageCreatingEvent,
} from "@silverbulletmd/silverbullet/type/event";
import {
  notFoundError,
  offlineError,
} from "@silverbulletmd/silverbullet/constants";
import { createEditorState } from "./codemirror/editor_state.ts";
import { diffAndPrepareChanges } from "./codemirror/cm_util.ts";
import { DocumentEditor } from "./document_editor.ts";
import { fsEndpoint } from "./spaces/constants.ts";
import { parseMarkdown } from "./markdown_parser/parser.ts";
import type { Client } from "./client.ts";
import type { LocationState } from "./navigator.ts";

const frontMatterRegex = /^---\n(([^\n]|\n)*?)---\n/;

const autoSaveInterval = 1000;

/**
 * Manages content lifecycle: loading, saving, reloading, and editor mode switching
 * for both markdown pages and non-markdown documents.
 */
export class ContentManager {
  documentEditor: DocumentEditor | null = null;
  saveTimeout?: ReturnType<typeof setTimeout>;
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
        () => {
          if (
            !this.client.ui.viewState.unsavedChanges ||
            this.client.isReadOnlyMode()
          ) {
            // No unsaved changes, or read-only mode, not gonna save
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

            // Only thing we can really do is request a save
            this.documentEditor.requestSave();

            return resolve();
          } else {
            // Do not save while IME composition is active
            if (this.client.editorView.composing) {
              // Re-schedule save after composition likely ends
              this.saveTimeout = setTimeout(
                this.save.bind(this),
                autoSaveInterval,
              );
              return resolve();
            }

            console.log("Saving page", this.client.currentPath());
            void this.client.dispatchAppEvent(
              "editor:pageSaving",
              this.client.currentName(),
            );
            this.client.space
              .writePage(
                this.client.currentName(),
                this.client.editorView.state.sliceDoc(0),
              )
              .then(async (meta) => {
                this.client.ui.viewDispatch({ type: "page-saved" });
                await this.client.dispatchAppEvent(
                  "editor:pageSaved",
                  this.client.currentName(),
                  meta,
                );

                // At this all the essential stuff is done, let's proceed
                resolve();

                // In the background we'll fetch any enriched meta data, if any
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

                  // Skip during IME composition
                  if (!this.client.editorView.composing) {
                    // Trigger editor re-render to update Lua widgets
                    // with the new metadata
                    this.client.editorView.dispatch({});
                  }
                }
              })
              .catch((e) => {
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

  async loadDocumentEditor(locationState: LocationState) {
    const path = locationState.path;
    if (isMarkdownPath(path)) throw Error("This is a markdown path");

    const previousPath = this.client.ui.viewState.current?.path;
    const loadingDifferentPath = previousPath
      ? previousPath !== path
      : // Always load as different editor if editor is loaded from scratch
        true;

    if (previousPath) {
      this.client.space.unwatchFile(previousPath);
      await this.save(true);
      await this.client.objectIndex.awaitIndexQueueDrain();
    }

    // This can throw, but that will be catched and handled upstream.
    const doc = await this.client.space.readDocument(path);

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
          this.client.openUrl(
            `${document.baseURI.replace(/\/*$/, "") + fsEndpoint}/${path}`,
            !previousPath,
          );
        }

        throw e;
      }

      if (!this.isDocumentEditor()) {
        throw new Error("Problem setting up document editor");
      }
    }

    this.documentEditor!.openFile(doc.data, doc.meta, locationState.details);

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

    const previousPath = this.client.ui.viewState.current?.path;
    const loadingDifferentPath = previousPath
      ? previousPath !== path
      : // Always load as different page if page is loaded from scratch
        true;
    const pageName = getNameFromPath(path);

    if (previousPath) {
      this.client.space.unwatchFile(previousPath);
      await this.save(true);
      await this.client.objectIndex.awaitIndexQueueDrain();
    }

    // Fetch next page to open
    let doc;
    let markerIndex = -1;
    try {
      doc = await this.client.space.readPage(pageName);
    } catch (e: any) {
      if (
        e.message !== notFoundError.message &&
        e.message !== offlineError.message
      ) {
        // If the error is not a "not found" or "offline" error, rethrow it
        throw e;
      }

      if (e.message === offlineError.message) {
        console.info(
          "Currently offline, will assume page doesn't exist:",
          pageName,
        );
      }

      // Scenarios:
      // 1. We got a not found error -> Create an empty page
      // 2. We got a offline error (which meant that the service worker didn't locally retrieve the page either so likely it doesn't exist) -> Create a new page
      // Either way... we create an empty page!

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
      const results = (await this.client.dispatchAppEvent(
        "editor:pageCreating",
        {
          name: pageName,
        } as PageCreatingEvent,
      )) as PageCreatingContent[];

      if (results.length === 1) {
        doc.text = results[0].text;
        doc.meta.perm = results[0].perm;
        // check for |^| and remove it; record position to place cursor later
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

    await this.client.pageMetaAugmenter.setAugmentation(pageName, {
      lastOpened: Date.now(),
    });

    this.client.ui.viewDispatch({
      type: "page-loaded",
      meta: doc.meta,
      path: path,
    });

    // Fetch the meta which includes the possibly indexed stuff, like page
    // decorations
    if (await this.client.objectIndex.hasFullIndexCompleted()) {
      try {
        const enrichedMeta =
          (await this.client.objectIndex.getObjectByRef(
            pageName,
            "page",
            pageName,
          )) ?? doc.meta;

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

    // When loading a different page OR if the page is read-only (in which case we don't want to apply local patches, because there's no point)
    if (loadingDifferentPath || doc.meta.perm === "ro") {
      const editorState = createEditorState(
        this.client,
        pageName,
        doc.text,
        doc.meta.perm === "ro",
      );
      this.client.editorView.setState(editorState);
    } else {
      // Just apply minimal patches so that the cursor is preserved
      this.setEditorText(doc.text, true);
    }

    this.client.space.watchFile(path);

    if (navigateWithinPage) {
      // Setup scroll position, cursor position, etc
      try {
        this.navigateWithinPage(locationState);
      } catch {
        // We don't really care if this fails.
      }
    }
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

    // This is probably not the best way to hide the codemirror editor, but it works
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
    // This is a little hacky but any other solution would pose a larger rewrite
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

  private navigateWithinPage(pageState: LocationState) {
    if (!isMarkdownPath(pageState.path)) return;

    // We can't use getOffsetFromRef here, because it is asyncronous.
    let pos: number | undefined;

    // Don't use getOffsetFromRef, so we can show error messages
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

      // If a position was specified, we bail out and ignore any cached state
      return;
    }

    let adjustedPosition = false;

    // Was a particular scroll position persisted?
    if (pageState.scrollTop && pageState.scrollTop > 0) {
      setTimeout(() => {
        this.client.editorView.scrollDOM.scrollTop = pageState.scrollTop!;
      });
      adjustedPosition = true;
    }

    // Was a particular cursor/selection set?
    if (pageState.selection?.anchor) {
      this.client.editorView.dispatch({
        selection: pageState.selection,
      });
      adjustedPosition = true;
    }

    // If not: just put the cursor at the top of the page, right after the frontmatter
    if (!adjustedPosition) {
      // Somewhat ad-hoc way to determine if the document contains frontmatter and if so, putting the cursor _after it_.
      const pageText = this.client.editorView.state.sliceDoc();

      // Default the cursor to be at position 0
      let initialCursorPos = 0;
      const match = frontMatterRegex.exec(pageText);
      if (match) {
        // Frontmatter found, put cursor after it
        initialCursorPos = match[0].length;
      }
      // By default scroll to the top
      this.client.editorView.scrollDOM.scrollTop = 0;
      this.client.editorView.dispatch({
        selection: { anchor: initialCursorPos },
        // And then scroll down if required
        scrollIntoView: true,
      });
    }
  }
}

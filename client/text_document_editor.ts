import { EditorSelection, type Text } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  getOffsetFromLineColumn,
  type Path,
  type Ref,
} from "@silverbulletmd/silverbullet/lib/ref";
import type { DocumentMeta } from "@silverbulletmd/silverbullet/type/index";
import type { Client } from "./client.ts";
import {
  createEditorState,
  type EditorMode,
} from "./codemirror/editor_state.ts";
import type { ActiveDocumentEditor } from "./document_editor.ts";
import { TEXT_DOCUMENT_LIMIT } from "./document_editor_resolver.ts";
import { languageNameForExtension, loadLanguageFor } from "./languages.ts";

export class TextDocumentOpenError extends Error {
  constructor(readonly reason: "too-large" | "binary") {
    super(
      reason === "too-large"
        ? "Document exceeds the 5 MiB text limit"
        : "Document is not valid UTF-8",
    );
  }
}

type PendingTextDocumentSave = {
  meta: DocumentMeta;
  doc: Text;
  promise: Promise<void>;
};

export class TextDocumentEditor implements ActiveDocumentEditor {
  readonly name = "TextEditor";
  readonly needsBytes = true;
  extension = "";
  private meta?: DocumentMeta;
  private savedDoc?: Text;
  private pendingSave?: PendingTextDocumentSave;
  private hasUtf8Bom = false;

  constructor(
    readonly parent: HTMLElement,
    readonly client: Client,
  ) {}

  get hasUnsavedChanges(): boolean {
    return (
      !!this.meta &&
      (this.pendingSave !== undefined ||
        !this.savedDoc?.eq(this.client.editorView.state.doc))
    );
  }

  async openFile(
    data: Uint8Array | undefined,
    meta: DocumentMeta,
    details: Ref["details"],
  ): Promise<void> {
    const install = await this.prepareFile(data, meta, details);
    install();
  }

  async prepareFile(
    data: Uint8Array | undefined,
    meta: DocumentMeta,
    details: Ref["details"],
  ): Promise<() => void> {
    if (!data) throw new Error("Text editor requires file bytes");
    if (
      meta.size > TEXT_DOCUMENT_LIMIT ||
      data.byteLength > TEXT_DOCUMENT_LIMIT
    ) {
      throw new TextDocumentOpenError("too-large");
    }
    const hasUtf8Bom =
      data.byteLength >= 3 &&
      data[0] === 0xef &&
      data[1] === 0xbb &&
      data[2] === 0xbf;
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(data);
    } catch {
      throw new TextDocumentOpenError("binary");
    }
    const extension = meta.extension.toLowerCase();
    const languageName = languageNameForExtension(extension);
    const language = languageName ? await loadLanguageFor(languageName) : null;
    const mode: EditorMode = {
      kind: "text-document",
      path: meta.name as Path,
      language,
    };
    return () => {
      const previousMode = this.client.contentManager.hostEditorMode;
      this.client.contentManager.hostEditorMode = mode;
      try {
        const pos =
          details?.type === "position"
            ? details.pos
            : details?.type === "linecolumn"
              ? getOffsetFromLineColumn(text, details.line, details.column)
              : 0;
        const state = createEditorState(
          this.client,
          mode,
          text,
          meta.perm === "ro",
          EditorSelection.single(Math.max(0, Math.min(pos, text.length))),
        );
        this.client.editorView.setState(state);
      } catch (error) {
        this.client.contentManager.hostEditorMode = previousMode;
        throw error;
      }
      this.meta = meta;
      this.hasUtf8Bom = hasUtf8Bom;
      this.savedDoc = this.client.editorView.state.doc;
      this.extension = extension;
      for (const child of Array.from(this.parent.children)) {
        if (child !== this.client.editorView.dom) child.remove();
      }
      this.parent.classList.remove("hide-cm");
      this.client.editorView.scrollDOM.scrollTop = 0;
      this.client.editorView.scrollDOM.scrollLeft = 0;
      if (details?.type === "position" || details?.type === "linecolumn") {
        this.client.editorView.dispatch({
          effects: EditorView.scrollIntoView(
            this.client.editorView.state.selection.main.head,
          ),
        });
      }
    };
  }

  async requestSave(): Promise<void> {
    if (
      !this.meta ||
      this.meta.perm === "ro" ||
      this.client.isReadOnlyMode() ||
      this.client.editorView.state.readOnly
    )
      return;
    const openedMeta = this.meta;
    const path = this.meta.name;
    const doc = this.client.editorView.state.doc;
    const previousSave = this.pendingSave;
    if (previousSave?.meta === openedMeta && previousSave.doc.eq(doc)) {
      await previousSave.promise;
      return;
    }
    const encoded = new TextEncoder().encode(doc.toString());
    let bytes = encoded;
    if (this.hasUtf8Bom) {
      bytes = new Uint8Array(encoded.byteLength + 3);
      bytes.set([0xef, 0xbb, 0xbf]);
      bytes.set(encoded, 3);
    }
    const saving: PendingTextDocumentSave = {
      meta: openedMeta,
      doc,
      promise: (
        previousSave?.promise.catch(() => {}) ?? Promise.resolve()
      ).then(async () => {
        try {
          const meta = await this.client.space.writeDocument(path, bytes);
          if (this.meta === openedMeta) this.savedDoc = doc;
          if (
            this.pendingSave === saving &&
            this.meta === openedMeta &&
            doc.eq(this.client.editorView.state.doc)
          ) {
            this.client.ui.viewDispatch({ type: "document-editor-saved" });
          }
          await this.client.dispatchAppEvent(
            "editor:documentSaved",
            path,
            meta,
          );
        } catch (error) {
          this.client.ui.flashNotification(
            "Could not save document, retrying again in 10 seconds",
            "error",
          );
          this.client.contentManager.saveTimeout = setTimeout(() => {
            void this.client.save().catch(console.error);
          }, 10000);
          throw error;
        }
      }),
    };
    this.pendingSave = saving;
    try {
      await saving.promise;
    } finally {
      if (this.pendingSave === saving) this.pendingSave = undefined;
    }
  }

  focus(): void {
    this.client.editorView.focus();
  }

  destroy(): void {
    this.meta = undefined;
    this.hasUtf8Bom = false;
  }

  updateTheme(): void {
    this.client.rebuildEditorState();
  }
}

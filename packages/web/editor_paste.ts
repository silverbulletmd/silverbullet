import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { safeRun } from "@plugos/plugos/util";
import { maximumAttachmentSize } from "@silverbulletmd/common/types";
import { Editor } from "./editor";

const urlRegexp =
  /^https?:\/\/[-a-zA-Z0-9@:%._\+~#=]{1,256}([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;

// Known iOS Safari paste issue (unrelated to this implementation): https://voxpelli.com/2015/03/ios-safari-url-copy-paste-bug/
export const pasteLinkExtension = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate): void {
      update.transactions.forEach((tr) => {
        if (tr.isUserEvent("input.paste")) {
          let pastedText: string[] = [];
          let from = 0;
          let to = 0;
          tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
            pastedText.push(inserted.sliceString(0));
            from = fromA;
            to = toB;
          });
          let pastedString = pastedText.join("");
          if (pastedString.match(urlRegexp)) {
            let selection = update.startState.selection.main;
            if (!selection.empty) {
              setTimeout(() => {
                update.view.dispatch({
                  changes: [
                    {
                      from: from,
                      to: to,
                      insert: `[${update.startState.sliceDoc(
                        selection.from,
                        selection.to
                      )}](${pastedString})`,
                    },
                  ],
                });
              });
            }
          }
        }
      });
    }
  }
);

export function attachmentExtension(editor: Editor) {
  return EditorView.domEventHandlers({
    dragover: (event) => {
      event.preventDefault();
    },
    drop: (event: DragEvent) => {
      // TODO: This doesn't take into account the target cursor position,
      // it just drops the attachment wherever the cursor was last.
      if (event.dataTransfer) {
        let payload = [...event.dataTransfer.files];
        if (!payload.length) {
          return;
        }
        safeRun(async () => {
          await processFileTransfer(payload);
        });
      }
    },
    paste: (event: ClipboardEvent) => {
      let payload = [...event.clipboardData!.items];
      if (!payload.length || payload.length === 0) {
        return false;
      }
      safeRun(async () => {
        await processItemTransfer(payload);
      });
    },
  });

  async function processFileTransfer(payload: File[]) {
    let data = await payload[0].arrayBuffer();
    await saveFile(data!, payload[0].name, payload[0].type);
  }

  async function processItemTransfer(payload: DataTransferItem[]) {
    let file = payload.find((item) => item.kind === "file");
    if (!file) {
      return false;
    }
    const fileType = file.type;
    let ext = fileType.split("/")[1];
    let fileName = new Date()
      .toISOString()
      .split(".")[0]
      .replace("T", "_")
      .replaceAll(":", "-");
    let data = await file!.getAsFile()?.arrayBuffer();
    await saveFile(data!, `${fileName}.${ext}`, fileType);
  }

  async function saveFile(
    data: ArrayBuffer,
    suggestedName: string,
    mimeType: string
  ) {
    if (data!.byteLength > maximumAttachmentSize) {
      editor.flashNotification(
        `Attachment is too large, maximum is ${
          maximumAttachmentSize / 1024 / 1024
        }MB`,
        "error"
      );
      return;
    }

    let finalFileName = prompt(
      "File name for pasted attachment",
      suggestedName
    );
    if (!finalFileName) {
      return;
    }
    await editor.space.writeAttachment(finalFileName, "arraybuffer", data!);
    let attachmentMarkdown = `[${finalFileName}](${finalFileName})`;
    if (mimeType.startsWith("image/")) {
      attachmentMarkdown = `![](${finalFileName})`;
    }
    editor.editorView!.dispatch({
      changes: [
        {
          insert: attachmentMarkdown,
          from: editor.editorView!.state.selection.main.from,
        },
      ],
    });
  }
}

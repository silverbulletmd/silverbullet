import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Space } from "@silverbulletmd/common/spaces/space";
import { createImportSpecifier } from "typescript";

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

export function pasteAttachmentExtension(space: Space) {
  return EditorView.domEventHandlers({
    paste: (event: ClipboardEvent, editor) => {
      let payload = [...event.clipboardData!.items];

      if (!payload.length || payload.length === 0) {
        return false;
      }
      let file = payload.find((item) => item.kind === "file");
      if (!file) {
        return false;
      }
      const fileType = file.type;
      Promise.resolve()
        .then(async () => {
          let data = await file!.getAsFile()?.arrayBuffer();
          let ext = fileType.split("/")[1];
          let fileName = new Date()
            .toISOString()
            .split(".")[0]
            .replace("T", "_")
            .replaceAll(":", "-");
          let finalFileName = prompt(
            "File name for pasted attachment",
            `${fileName}.${ext}`
          );
          if (!finalFileName) {
            return;
          }
          await space.writeAttachment(finalFileName, data!);
          let attachmentMarkdown = `[${finalFileName}](attachment/${finalFileName})`;
          if (fileType.startsWith("image/")) {
            attachmentMarkdown = `![](attachment/${finalFileName})`;
          }
          editor.dispatch({
            changes: [
              {
                insert: attachmentMarkdown,
                from: editor.state.selection.main.from,
              },
            ],
          });
        })
        .catch(console.error);
    },
  });
}

import { syntaxTree } from "@codemirror/language";
import { EditorView, ViewPlugin, ViewUpdate } from "@codemirror/view";
import { Client } from "../client.ts";

// We use turndown to convert HTML to Markdown
import TurndownService from "turndown";

// With tables and task notation as well
import { tables, taskListItems } from "turndown-plugin-gfm";
import { lezerToParseTree } from "$common/markdown_parser/parse_tree.ts";
import {
  addParentPointers,
  findParentMatching,
  nodeAtPos,
} from "../../plug-api/lib/tree.ts";
import { folderName, resolve } from "$lib/path.ts";
import { maximumAttachmentSize } from "../constants.ts";
import { safeRun } from "$lib/async.ts";

const turndownService = new TurndownService({
  hr: "---",
  codeBlockStyle: "fenced",
  headingStyle: "atx",
  emDelimiter: "*",
  bulletListMarker: "*", // Duh!
  strongDelimiter: "**",
  linkStyle: "inlined",
});
turndownService.use(taskListItems);
turndownService.use(tables);

function striptHtmlComments(s: string): string {
  return s.replace(/<!--[\s\S]*?-->/g, "");
}

const urlRegexp =
  /^https?:\/\/[-a-zA-Z0-9@:%._\+~#=]{1,256}([-a-zA-Z0-9()@:%_\+.~#?&//=]*)/;

// Known iOS Safari paste issue (unrelated to this implementation): https://voxpelli.com/2015/03/ios-safari-url-copy-paste-bug/
export const pasteLinkExtension = ViewPlugin.fromClass(
  class {
    update(update: ViewUpdate): void {
      update.transactions.forEach((tr) => {
        if (tr.isUserEvent("input.paste")) {
          const pastedText: string[] = [];
          let from = 0;
          let to = 0;
          tr.changes.iterChanges((fromA, _toA, _fromB, toB, inserted) => {
            pastedText.push(inserted.sliceString(0));
            from = fromA;
            to = toB;
          });
          const pastedString = pastedText.join("");
          if (pastedString.match(urlRegexp)) {
            const selection = update.startState.selection.main;
            if (!selection.empty) {
              setTimeout(() => {
                update.view.dispatch({
                  changes: [
                    {
                      from: from,
                      to: to,
                      insert: `[${
                        update.startState.sliceDoc(
                          selection.from,
                          selection.to,
                        )
                      }](${pastedString})`,
                    },
                  ],
                });
              });
            }
          }
        }
      });
    }
  },
);

export function attachmentExtension(editor: Client) {
  let shiftDown = false;
  return EditorView.domEventHandlers({
    dragover: (event) => {
      event.preventDefault();
    },
    keydown: (event) => {
      if (event.key === "Shift") {
        shiftDown = true;
      }
      return false;
    },
    keyup: (event) => {
      if (event.key === "Shift") {
        shiftDown = false;
      }
      return false;
    },
    drop: (event: DragEvent) => {
      // TODO: This doesn't take into account the target cursor position,
      // it just drops the attachment wherever the cursor was last.
      if (event.dataTransfer) {
        const payload = [...event.dataTransfer.files];
        if (!payload.length) {
          return;
        }
        safeRun(async () => {
          await processFileTransfer(payload);
        });
      }
    },
    paste: (event: ClipboardEvent) => {
      const payload = [...event.clipboardData!.items];
      const richText = event.clipboardData?.getData("text/html");

      // Only do rich text paste if shift is NOT down
      if (richText && !shiftDown) {
        // Are we in a fencede code block?
        const editorText = editor.editorView.state.sliceDoc();
        const tree = lezerToParseTree(
          editorText,
          syntaxTree(editor.editorView.state).topNode,
        );
        addParentPointers(tree);
        const currentNode = nodeAtPos(
          tree,
          editor.editorView.state.selection.main.from,
        );
        if (currentNode) {
          const fencedParentNode = findParentMatching(
            currentNode,
            (t) => ["FrontMatter", "FencedCode"].includes(t.type!),
          );
          if (
            fencedParentNode ||
            ["FrontMatter", "FencedCode"].includes(currentNode.type!)
          ) {
            console.log("Inside of fenced code block, not pasting rich text");
            return false;
          }
        }

        const markdown = striptHtmlComments(turndownService.turndown(richText))
          .trim();
        const view = editor.editorView;
        const selection = view.state.selection.main;
        view.dispatch({
          changes: [
            {
              from: selection.from,
              to: selection.to,
              insert: markdown,
            },
          ],
          selection: {
            anchor: selection.from + markdown.length,
          },
          scrollIntoView: true,
        });
        return true;
      }
      if (!payload.length || payload.length === 0) {
        return false;
      }
      safeRun(async () => {
        await processItemTransfer(payload);
      });
    },
  });

  async function processFileTransfer(payload: File[]) {
    const data = await payload[0].arrayBuffer();
    // data.byteLength > maximumAttachmentSize;
    await saveFile(data!, payload[0].name, payload[0].type);
  }

  async function processItemTransfer(payload: DataTransferItem[]) {
    const file = payload.find((item) => item.kind === "file");
    if (!file) {
      return false;
    }
    const fileType = file.type;
    const ext = fileType.split("/")[1];
    const fileName = new Date()
      .toISOString()
      .split(".")[0]
      .replace("T", "_")
      .replaceAll(":", "-");
    const data = await file!.getAsFile()?.arrayBuffer();
    await saveFile(data!, `${fileName}.${ext}`, fileType);
  }

  async function saveFile(
    data: ArrayBuffer,
    suggestedName: string,
    mimeType: string,
  ) {
    const maxSize = editor.settings.maximumAttachmentSize || maximumAttachmentSize;
    if (data!.byteLength > (maxSize * 1024 * 1024)) {
      editor.flashNotification(
        `Attachment is too large, maximum is ${maxSize}MiB`,
        "error",
      );
      return;
    }

    const finalFileName = await editor.prompt(
      "File name for pasted attachment",
      suggestedName,
    );
    if (!finalFileName) {
      return;
    }
    await editor.space.writeAttachment(
      resolve(folderName(editor.currentPage), finalFileName),
      new Uint8Array(data),
    );
    let attachmentMarkdown = `[${finalFileName}](${encodeURI(finalFileName)})`;
    if (mimeType.startsWith("image/")) {
      attachmentMarkdown = `![](${encodeURI(finalFileName)})`;
    }
    editor.editorView.dispatch({
      changes: [
        {
          insert: attachmentMarkdown,
          from: editor.editorView.state.selection.main.from,
        },
      ],
    });
  }
}

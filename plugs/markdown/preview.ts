import {
  clientStore,
  editor,
  space,
  system,
} from "$sb/silverbullet-syscall/mod.ts";
import { asset } from "$sb/plugos-syscall/mod.ts";
import { parseMarkdown } from "../../plug-api/silverbullet-syscall/markdown.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";

export async function updateMarkdownPreview() {
  if (!(await clientStore.get("enableMarkdownPreview"))) {
    return;
  }
  const text = await editor.getText();
  const mdTree = await parseMarkdown(text);
  // const cleanMd = await cleanMarkdown(text);
  const css = await asset.readAsset("assets/styles.css");
  const js = await asset.readAsset("assets/handler.js");
  const html = await renderMarkdownToHtml(mdTree, {
    smartHardBreak: true,
    annotationPositions: true,
    renderFrontMatter: true,
    inlineAttachments: async (url): Promise<string> => {
      if (!url.includes("://")) {
        try {
          return await space.readAttachment(url);
        } catch (e: any) {
          console.error(e);
          return url;
        }
      }
      return url;
    },
  });
  await editor.showPanel(
    "rhs",
    2,
    `<html><head><style>${css}</style></head><body><div id="root">${html}</div></body></html>`,
    js,
  );
}

export async function previewClickHandler(e: any) {
  const [eventName, arg] = JSON.parse(e);
  // console.log("Got click", eventName, arg);
  switch (eventName) {
    case "pos":
      // console.log("Moving cursor to", +arg);
      await editor.moveCursor(+arg, true);
      break;
    case "command":
      await system.invokeCommand(arg);
      break;
  }
}

import { editor, space, system } from "$sb/silverbullet-syscall/mod.ts";
import { asset, store } from "$sb/plugos-syscall/mod.ts";
import { parseMarkdown } from "$sb/silverbullet-syscall/markdown.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";

export async function updateMarkdownPreview() {
  if (!(await store.get("enableMarkdownPreview"))) {
    return;
  }
  const text = await editor.getText();
  const mdTree = await parseMarkdown(text);
  // const cleanMd = await cleanMarkdown(text);
  const css = await asset.readAsset("assets/styles.css");
  const js = await asset.readAsset("assets/handler.js");
  const html = renderMarkdownToHtml(mdTree, {
    smartHardBreak: true,
    annotationPositions: true,
    inlineAttachments: (url) => {
      if (!url.includes("://")) {
        return `/.fs/${url}`;
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

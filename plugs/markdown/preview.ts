import MarkdownIt from "https://esm.sh/markdown-it@13.0.1";
import taskLists from "https://esm.sh/markdown-it-task-lists@2.1.1";

import { clientStore, editor } from "$sb/silverbullet-syscall/mod.ts";
import { asset } from "$sb/plugos-syscall/mod.ts";
import { cleanMarkdown } from "./util.ts";

const md = new MarkdownIt({
  linkify: true,
  html: false,
  typographer: true,
}).use(taskLists);

export async function updateMarkdownPreview() {
  if (!(await clientStore.get("enableMarkdownPreview"))) {
    return;
  }
  const text = await editor.getText();
  const cleanMd = await cleanMarkdown(text);
  const css = await asset.readAsset("styles.css");
  await editor.showPanel(
    "rhs",
    2,
    `<html><head><style>${css}</style></head><body>${
      md.render(cleanMd)
    }</body></html>`,
  );
}

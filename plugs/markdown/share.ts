import { markdown, space } from "$sb/silverbullet-syscall/mod.ts";
import { LocalFileSystem } from "$sb/plugos-syscall/mod.ts";
import { asset } from "$sb/plugos-syscall/mod.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";
import { PublishEvent } from "$sb/app_event.ts";

export async function sharePublisher(event: PublishEvent) {
  const path = event.uri.split(":")[1];
  const pageName = event.name;
  const text = await space.readPage(pageName);
  const tree = await markdown.parseMarkdown(text);

  const rootFS = new LocalFileSystem("");

  const css = await asset.readAsset("assets/styles.css");
  const markdownHtml = renderMarkdownToHtml(tree, {
    smartHardBreak: true,
  });
  const html =
    `<html><head><style>${css}</style></head><body><div id="root">${markdownHtml}</div></body></html>`;
  await rootFS.writeFile(path, html, "utf8");
  return true;
}

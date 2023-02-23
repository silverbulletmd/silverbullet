import { parseMarkdown } from "$sb/silverbullet-syscall/markdown.ts";
import type { WidgetContent } from "$sb/app_event.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";

export async function markdownWidget(
  bodyText: string,
): Promise<WidgetContent> {
  const mdTree = await parseMarkdown(bodyText);

  const html = await renderMarkdownToHtml(mdTree, {
    smartHardBreak: true,
  });
  return Promise.resolve({
    html: html,
    script: `updateHeight();
    document.addEventListener("click", () => {
      api({type: "blur"});
    });`,
  });
}

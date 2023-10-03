import { markdown } from "$sb/syscalls.ts";
import type { WidgetContent } from "$sb/app_event.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";

export async function markdownWidget(
  bodyText: string,
): Promise<WidgetContent> {
  const mdTree = await markdown.parseMarkdown(bodyText);

  const html = renderMarkdownToHtml(mdTree, {
    smartHardBreak: true,
  });
  return Promise.resolve({
    html: html,
    script: `
    document.addEventListener("click", () => {
      api({type: "blur"});
    });`,
  });
}

import { parseMarkdown } from "$sb/silverbullet-syscall/markdown.ts";
import { renderMarkdownToHtml } from "./markdown_render.ts";

export async function markdownWidget(
  bodyText: string,
): Promise<{ html: string; script: string }> {
  const mdTree = await parseMarkdown(bodyText);

  const html = renderMarkdownToHtml(mdTree, {
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

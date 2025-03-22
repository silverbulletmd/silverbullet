import { parseMarkdown } from "../../plug-api/syscalls/markdown.ts";
import {
  type MarkdownRenderOptions,
  renderMarkdownToHtml,
} from "./markdown_render.ts";

export async function markdownToHtml(
  markdown: string,
  options: MarkdownRenderOptions = {},
) {
  const mdTree = await parseMarkdown(markdown);
  return renderMarkdownToHtml(mdTree, options);
}

import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { parse } from "../markdown_parser/parse_tree.ts";
import { buildExtendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import {
  type MarkdownRenderOptions,
  renderMarkdownToHtml,
} from "../markdown_renderer/markdown_render.ts";

/**
 * Renders a widget's Markdown without evaluating anything in it: Lua
 * directives stay literal text and transclusions are not resolved, so text
 * written by users, imports or agents can be shown safely
 * (`widget.new { markdown = s, evaluate = false }`).
 */
export function renderLiteralMarkdown(
  markdown: string,
  allPages: PageMeta[],
  options: MarkdownRenderOptions = {},
): string {
  const tree = parse(buildExtendedMarkdownLanguage({}), markdown);
  return renderMarkdownToHtml(
    tree,
    { ...options, resolveTransclusion: undefined },
    allPages,
  );
}

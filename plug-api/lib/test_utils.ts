import type { ParseTree } from "$sb/lib/tree.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../../common/markdown_parser/parser.ts";

export function parseMarkdown(text: string): ParseTree {
  return parse(extendedMarkdownLanguage, text);
}

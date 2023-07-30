import wikiMarkdownLang from "../../common/markdown_parser/parser.ts";
import type { ParseTree } from "$sb/lib/tree.ts";
import { parse } from "../../common/markdown_parser/parse_tree.ts";

export function parseMarkdown(text: string): ParseTree {
  const lang = wikiMarkdownLang([]);
  return parse(lang, text);
}

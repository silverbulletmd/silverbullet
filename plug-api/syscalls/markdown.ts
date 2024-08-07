import { syscall } from "../syscall.ts";
import type { ParseTree } from "../lib/tree.ts";

/**
 * Parses a piece of markdown text into a ParseTree.
 * @param text the markdown text to parse
 * @returns a ParseTree representation of the markdown text
 */
export function parseMarkdown(text: string): Promise<ParseTree> {
  return syscall("markdown.parseMarkdown", text);
}

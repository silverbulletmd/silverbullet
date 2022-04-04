import {syscall} from "./syscall";
import type {MarkdownTree} from "../common/tree";

export async function parseMarkdown(text: string): Promise<MarkdownTree> {
  return syscall("markdown.parseMarkdown", text);
}

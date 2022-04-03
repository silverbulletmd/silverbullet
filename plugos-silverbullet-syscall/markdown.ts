import {syscall} from "./syscall";
import type {MarkdownTree} from "../common/tree";

export async function parse(text: string): Promise<MarkdownTree> {
  return syscall("markdown.parse", text);
}

export async function nodeAtPos(
  mdTree: MarkdownTree,
  pos: number
): Promise<any | null> {
  return syscall("markdown.nodeAtPos", mdTree, pos);
}

export async function render(mdTree: MarkdownTree): Promise<string> {
  return syscall("markdown.render", mdTree);
}

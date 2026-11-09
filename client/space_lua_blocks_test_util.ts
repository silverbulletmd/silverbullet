import { findToolBlocks } from "@silverbulletmd/silverbullet/lib/tool_pages";
import { parseMarkdown } from "./markdown_parser/parser.ts";

/** The page's `space-lua` code, all blocks joined, for tests that run a page's scripts. */
export function extractSpaceLuaFromPageText(text: string): string {
  return findToolBlocks(parseMarkdown(text))
    .filter((b) => b.fence === "space-lua")
    .map((b) => b.code)
    .join("\n");
}

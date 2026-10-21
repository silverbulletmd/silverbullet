import { highlightCode } from "@lezer/highlight";
import { luaLanguage } from "../../space_lua/parse.ts";
import { editorHighlightStyle } from "../../style.ts";

export type HighlightSegment = { text: string; cls: string };

let style: ReturnType<typeof editorHighlightStyle> | undefined;

/** Lua source as segments carrying the same token classes the editor uses. */
export function highlightLua(code: string): HighlightSegment[] {
  style ??= editorHighlightStyle();
  const segments: HighlightSegment[] = [];
  highlightCode(
    code,
    luaLanguage.parser.parse(code),
    style,
    (text, cls) => segments.push({ text, cls }),
    () => segments.push({ text: "\n", cls: "" }),
  );
  return segments;
}

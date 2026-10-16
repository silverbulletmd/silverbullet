import type {
  CompletionContext,
  CompletionResult,
  CompletionSource,
} from "@codemirror/autocomplete";
import { withCompletionInfo } from "../codemirror/editing/completion_info.ts";
import {
  luaAccessAt,
  luaCompletionOptions,
} from "../space_lua/completion_options.ts";
import type { LuaEnv } from "../space_lua/runtime.ts";
import { inspectLuaPath } from "../space_lua/syscalls.ts";

export function replCompletionSource(env: () => LuaEnv): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const line = ctx.state.doc.lineAt(ctx.pos);
    const linePrefix = line.text.slice(0, ctx.pos - line.from);
    if (insideStringOrComment(linePrefix)) return null;
    // Only an explicit trigger (Ctrl-Space) lists globals for an empty prefix
    const access =
      luaAccessAt(linePrefix) ??
      (ctx.explicit ? { parts: [], prefix: "" } : null);
    if (!access) return null;
    const inspection = await inspectLuaPath(env(), access.parts);
    const options = luaCompletionOptions(
      inspection?.properties ?? [],
      access.parts,
      access.prefix,
    );
    return options.length
      ? {
          from: ctx.pos - access.prefix.length,
          options: options.map(withCompletionInfo),
        }
      : null;
  };
}

// The syntax tree can't help here: an unclosed string, the usual case while typing, parses as names
function insideStringOrComment(linePrefix: string): boolean {
  let quote: string | null = null;
  for (let i = 0; i < linePrefix.length; i++) {
    const ch = linePrefix[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "-" && linePrefix[i + 1] === "-") {
      return true;
    }
  }
  return quote !== null;
}

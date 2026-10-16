import type { Ref } from "@silverbulletmd/silverbullet/lib/ref";
import type { LuaRuntimeError, LuaStackFrame } from "../space_lua/runtime.ts";
import { resolveASTReference } from "../space_lua.ts";
import { CONSOLE_REF_PREFIX } from "./console_session.ts";

export type FrameTarget =
  | { kind: "page"; ref: Ref }
  | { kind: "console"; ref: string };

export type SourceFrame = {
  label: string;
  line?: number;
  column?: number;
  excerpt?: { lineText: string; column: number; length: number };
  target?: FrameTarget;
};

/** The source code behind an AST ref: console input or a space script. */
export type SourceLookup = (ref: string) => string | undefined;

const HINT_SEPARATOR = "; hint: ";

export function splitHint(message: string): { message: string; hint?: string } {
  const i = message.indexOf(HINT_SEPARATOR);
  return i === -1
    ? { message }
    : {
        message: message.slice(0, i),
        hint: message.slice(i + HINT_SEPARATOR.length),
      };
}

/** Where `ctx` points: a label with its line, the line's excerpt, and what clicking it opens. */
export function frameAt(
  ctx: { ref: string; from: number; to?: number },
  sourceFor: SourceLookup,
): SourceFrame {
  const { ref, from } = ctx;
  const code = sourceFor(ref);
  const pos = code === undefined ? undefined : lineColumn(code, from);
  const isConsole = ref.startsWith(CONSOLE_REF_PREFIX);
  const name = isConsole ? ref : ref.split("@")[0];
  const pageRef = isConsole ? null : resolveASTReference(ctx);
  return {
    label: pos ? `${name}:${pos.line}` : name,
    line: pos?.line,
    column: pos?.column,
    excerpt: pos && {
      lineText: pos.lineText,
      column: pos.column,
      length: Math.max(
        1,
        Math.min((ctx.to ?? from + 1) - from, pos.lineText.length - pos.column),
      ),
    },
    target: isConsole
      ? { kind: "console", ref }
      : pageRef
        ? { kind: "page", ref: pageRef }
        : undefined,
  };
}

export function luaErrorFrames(
  err: LuaRuntimeError,
  sourceFor: SourceLookup,
): SourceFrame[] {
  const frames: SourceFrame[] = [];
  for (let sf: LuaStackFrame | undefined = err.sf; sf; sf = sf.parent) {
    const ctx = sf.astCtx;
    if (!ctx?.ref || ctx.from === undefined) break;
    frames.push(
      frameAt({ ref: ctx.ref, from: ctx.from, to: ctx.to }, sourceFor),
    );
  }
  return frames;
}

function lineColumn(code: string, offset: number) {
  const before = code.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  const lineEnd = code.indexOf("\n", offset);
  return {
    line: before.split("\n").length,
    column: offset - lineStart,
    lineText: code.slice(lineStart, lineEnd === -1 ? undefined : lineEnd),
  };
}

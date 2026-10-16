import { expect, test } from "vitest";
import {
  LuaEnv,
  LuaRuntimeError,
  LuaStackFrame,
} from "../space_lua/runtime.ts";
import { luaErrorFrames, scriptRefParts, splitHint } from "./source_frames.ts";

function errAt(
  ref: string | undefined,
  from: number,
  to: number,
  parent?: LuaStackFrame,
) {
  const sf = new LuaStackFrame(
    new LuaEnv(),
    ref === undefined ? null : { ref, from, to },
    parent,
  );
  return new LuaRuntimeError("boom", sf);
}

test("a space-lua frame resolves to the page position after the fence header", () => {
  const code = "local a = 1\nlocal b = a.x";
  const frames = luaErrorFrames(errAt("Sample Page@100", 22, 25), () => code);
  expect(frames).toHaveLength(1);
  expect(frames[0].label).toBe("Sample Page:2");
  expect(frames[0].excerpt).toEqual({
    lineText: "local b = a.x",
    column: 10,
    length: 3,
  });
  expect(frames[0].target).toEqual({
    kind: "page",
    ref: {
      path: "Sample Page.md",
      details: { type: "position", pos: 100 + "```space-lua\n".length + 22 },
    },
  });
});

test("a console frame targets the console input", () => {
  const frames = luaErrorFrames(errAt("console#3", 0, 1), () => "x()");
  expect(frames[0]).toMatchObject({
    label: "console#3:1",
    target: { kind: "console", ref: "console#3" },
  });
});

test("a frame with no position is not linked and stops the walk", () => {
  expect(luaErrorFrames(errAt(undefined, 0, 0), () => undefined)).toEqual([]);
});

test("parent frames are listed innermost first", () => {
  const outer = new LuaStackFrame(new LuaEnv(), {
    ref: "console#1",
    from: 0,
    to: 3,
  });
  const frames = luaErrorFrames(errAt("console#2", 0, 1, outer), () => "abc");
  expect(frames.map((f) => f.label)).toEqual(["console#2:1", "console#1:1"]);
});

test("splitHint separates the parser hint", () => {
  expect(splitHint("unexpected symbol near '='; hint: remove one '='")).toEqual(
    {
      message: "unexpected symbol near '='",
      hint: "remove one '='",
    },
  );
  expect(splitHint("plain")).toEqual({ message: "plain" });
});

test("script refs split into page name and offset", () => {
  expect(scriptRefParts("Library/Std/Config@741")).toEqual({
    page: "Library/Std/Config",
    pos: 741,
  });
  expect(scriptRefParts("Journal")).toEqual({ page: "Journal" });
});

import { afterEach, expect, test } from "vitest";
import type {
  CompleteEvent,
  EnrichedClickEvent,
} from "@silverbulletmd/silverbullet/type/client";
import { luaComplete, luaNavigate } from "./lua.ts";

const originalSyscall = globalThis.syscall;

afterEach(() => {
  globalThis.syscall = originalSyscall;
});

function completionEvent(
  linePrefix: string,
  luaCode = linePrefix,
): CompleteEvent {
  return {
    pageName: "Test",
    linePrefix,
    pos: luaCode.length,
    parentNodes: [`FencedCode:space-lua\n${luaCode}`],
  };
}

function clickEvent(pos: number, parentNodes: string[]): EnrichedClickEvent {
  return {
    page: "Test",
    pos,
    metaKey: false,
    ctrlKey: true,
    altKey: false,
    parentNodes,
  };
}

test("luaComplete returns documented function snippets", async () => {
  globalThis.syscall = async (name: string, ...args: any[]) => {
    expect(name).toBe("lua.inspect");
    expect(args).toEqual([["string"]]);
    return {
      type: "table",
      properties: [
        {
          key: "gmatch",
          type: "function",
          functionInfo: {
            kind: "builtin",
            name: "string.gmatch",
            description: "Iterates over matches in a string.",
            parameters: [
              { name: "s", type: "string" },
              { name: "pattern", type: "string" },
            ],
          },
        },
      ],
    };
  };

  expect(await luaComplete(completionEvent("string.gm"))).toEqual({
    from: "string.".length,
    options: [
      expect.objectContaining({
        label: "gmatch(s, pattern)",
        snippet: "gmatch(${})",
        detail: "Iterates over matches in a string.",
        documentation: expect.stringContaining("## string.gmatch"),
      }),
    ],
  });
});

test("luaComplete includes properties from schema-derived locals", async () => {
  globalThis.syscall = async (name: string, ...args: any[]) => {
    if (name === "config.get") {
      expect(args[0]).toEqual(["tags", "person", "schema"]);
      return {
        type: "object",
        properties: {
          name: { type: "string" },
          age: { type: "number" },
        },
      };
    }
    throw new Error(`Unexpected syscall: ${name}`);
  };

  const luaCode = "local person = tags.person\nperson.na";
  expect(await luaComplete(completionEvent("person.na", luaCode))).toEqual({
    from: luaCode.length - 2,
    options: [
      {
        label: "name",
        detail: "string",
      },
    ],
  });
});

test("luaNavigate opens Lua-defined function sources", async () => {
  const calls: [string, ...any[]][] = [];
  globalThis.syscall = async (name: string, ...args: any[]) => {
    calls.push([name, ...args]);
    if (name === "editor.getText") return "demo.greet()";
    if (name === "lua.inspect") {
      expect(args).toEqual([["demo", "greet"]]);
      return {
        type: "function",
        functionInfo: { kind: "lua", name: "demo.greet" },
        definition: "Library/Test@123",
        properties: [],
      };
    }
    if (name === "editor.navigate") return;
    throw new Error(`Unexpected syscall: ${name}`);
  };

  await luaNavigate(clickEvent(7, ["FencedCode:space-lua\ndemo.greet()"]));

  expect(calls).toContainEqual([
    "editor.navigate",
    "Library/Test@123",
    false,
    false,
  ]);
});

test("luaNavigate leaves Markdown links to regular navigation", async () => {
  globalThis.syscall = async (name: string) => {
    throw new Error(`Unexpected syscall: ${name}`);
  };

  await luaNavigate(
    clickEvent(7, ["WikiLink", "FencedCode:space-lua\nprint([[Some Page]])"]),
  );
});

test("luaNavigate reports values without Lua definitions", async () => {
  const calls: [string, ...any[]][] = [];
  globalThis.syscall = async (name: string, ...args: any[]) => {
    calls.push([name, ...args]);
    if (name === "editor.getText") return "string.gmatch()";
    if (name === "lua.inspect") {
      return {
        type: "function",
        functionInfo: { kind: "builtin", name: "string.gmatch" },
        properties: [],
      };
    }
    if (name === "editor.flashNotification") return;
    throw new Error(`Unexpected syscall: ${name}`);
  };

  await luaNavigate(clickEvent(8, ["FencedCode:space-lua\nstring.gmatch()"]));

  expect(calls).toContainEqual([
    "editor.flashNotification",
    "Cannot navigate to definition; not defined in Lua.",
    "info",
  ]);
});

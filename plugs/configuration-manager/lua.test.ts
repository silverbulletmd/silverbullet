import { describe, expect, test } from "vitest";
import { parseManagedBlock, toLua } from "./lua.ts";
import { installTestSyscalls } from "./test_syscalls.ts";

installTestSyscalls();

/** The value of a literal as read back from a managed `config.set` line. */
async function literal(s: string): Promise<any> {
  return (await parseManagedBlock(`config.set("x", ${s})`)).configOverrides.x;
}

describe("toLua", () => {
  test("booleans", async () => {
    expect(await toLua(true)).toBe("true");
    expect(await toLua(false)).toBe("false");
  });

  test("numbers", async () => {
    expect(await toLua(42)).toBe("42");
    expect(await toLua(3.14)).toBe("3.14");
    expect(await toLua(-1)).toBe("-1");
    expect(await toLua(0)).toBe("0");
  });

  test("simple strings", async () => {
    expect(await toLua("hello")).toBe('"hello"');
    expect(await toLua("")).toBe('""');
  });

  test("strings with special characters", async () => {
    expect(await toLua('say "hi"')).toBe('"say \\"hi\\""');
    expect(await toLua("back\\slash")).toBe('"back\\\\slash"');
    expect(await toLua("line\nbreak")).toBe('"line\\nbreak"');
    expect(await toLua("tab\there")).toBe('"tab\\there"');
  });

  test("flat object", async () => {
    expect(await toLua({ enabled: true, name: "test" })).toBe(
      '{\n  enabled = true,\n  name = "test",\n}',
    );
  });

  test("nested object", async () => {
    const val = { smartQuotes: { enabled: true, double: { left: "\u201c" } } };
    const result = await toLua(val);
    expect(result).toContain("smartQuotes = {");
    expect(result).toContain("enabled = true");
    expect(result).toContain("double = {");
  });

  test("empty object", async () => {
    expect(await toLua({})).toBe("{}");
  });

  test("array", async () => {
    expect(await toLua(["a", "b"])).toBe('{\n  "a",\n  "b",\n}');
  });

  test("non-finite numbers serialize as nil", async () => {
    expect(await toLua(Number.NaN)).toBe("nil");
    expect(await toLua(Number.POSITIVE_INFINITY)).toBe("nil");
    expect(await toLua([1, Number.NEGATIVE_INFINITY])).toBe(
      "{\n  1,\n  nil,\n}",
    );
  });

  test("an empty array serializes as an empty table and parses back as {}", async () => {
    // Lua cannot distinguish an empty array from an empty table
    expect(await toLua([])).toBe("{}");
    expect(await literal(await toLua([]))).toEqual({});
  });

  test("null and undefined are skipped in objects", async () => {
    expect(await toLua({ a: 1, b: null, c: undefined })).toBe("{a = 1}");
  });
});

describe("literal values", () => {
  test("scalars", async () => {
    expect(await literal("true")).toBe(true);
    expect(await literal("false")).toBe(false);
    expect(await literal("nil")).toBe(undefined);
    expect(await literal("42")).toBe(42);
    expect(await literal("-3.14")).toBe(-3.14);
    expect(await literal('"hello"')).toBe("hello");
    expect(await literal('""')).toBe("");
  });

  test("returns undefined for unsupported shapes", async () => {
    expect(await literal("foo.bar")).toBe(undefined);
    expect(await literal('{ "a", ')).toBe(undefined);
    expect(await literal("{ 1, a = 2 }")).toBe(undefined);
    expect(await literal("1 2")).toBe(undefined);
  });

  test("ignores surrounding whitespace", async () => {
    expect(await literal("  true  ")).toBe(true);
    expect(await literal('  "x"  ')).toBe("x");
  });
});

describe("toLua / parseManagedBlock round-trip (supported scalars)", () => {
  const cases: unknown[] = [
    true,
    false,
    undefined,
    0,
    42,
    -1,
    3.14,
    "",
    "hello",
    "with spaces",
  ];
  for (const value of cases) {
    test(`${JSON.stringify(value) ?? "undefined"}`, async () => {
      expect(await literal(await toLua(value))).toBe(value);
    });
  }
});

describe("toLua / parseManagedBlock round-trip (tables)", () => {
  const cases: unknown[] = [
    ["a"],
    ["b", "c"],
    [1, 2, 3],
    { a: 1, b: "x", c: true },
    { nested: { list: ["x", "y"], "my-key": 2 } },
    ['has "quote"', "tab\there", "new\nline", "back\\slash"],
    ["h\u00e9llo \u2713", "\u201c", "single 'quote'"],
    [{ a: 1 }, { b: [1, 2] }],
  ];
  for (const value of cases) {
    test(JSON.stringify(value), async () => {
      expect(await literal(await toLua(value))).toEqual(value);
    });
  }

  test("accepts inline whitespace and no trailing comma", async () => {
    expect(await literal('{ "a", "b" }')).toEqual(["a", "b"]);
    expect(await literal('{ x = 1, ["y z"] = {"q"} }')).toEqual({
      x: 1,
      "y z": ["q"],
    });
    expect(await literal("{}")).toEqual({});
  });

  test("accepts any Lua literal syntax", async () => {
    expect(await literal("'single'")).toBe("single");
    expect(await literal("[[long\nstring]]")).toBe("long\nstring");
    expect(await literal("{ 1; 2 }")).toEqual([1, 2]);
    expect(await literal("{ a = 1, -- note\n b = 2 }")).toEqual({
      a: 1,
      b: 2,
    });
  });

  test("rejects anything that is not exactly one literal", async () => {
    expect(await literal("1, 2")).toBe(undefined);
    expect(await literal("{ [1] = 2 }")).toBe(undefined);
    expect(await literal("{ f() }")).toBe(undefined);
  });
});

describe("parseManagedBlock", () => {
  test("multi-line table overrides alongside scalars and commands", async () => {
    const block = `-- managed-by: configuration-manager
config.set("flag", true)
config.set("share.spaces", ${await toLua(["https://h/a", "https://h/b"])})
config.set("obj", ${await toLua({ k: { z: [1, 2] } })})
command.update { name = "Foo: Bar", key = "Ctrl-f" }
config.set("after", "x")`;
    const { configOverrides, commandOverrides } =
      await parseManagedBlock(block);
    expect(configOverrides).toEqual({
      flag: true,
      "share.spaces": ["https://h/a", "https://h/b"],
      obj: { k: { z: [1, 2] } },
      after: "x",
    });
    expect(commandOverrides).toEqual({ "Foo: Bar": { key: "Ctrl-f" } });
  });

  test("parses config.set lines", async () => {
    const block = `-- managed-by: configuration-manager
config.set("shortWikiLinks", false)
config.set("smartQuotes.enabled", true)
config.set("autoCloseBrackets", "([{")`;
    const { configOverrides, commandOverrides } =
      await parseManagedBlock(block);
    expect(configOverrides).toEqual({
      shortWikiLinks: false,
      "smartQuotes.enabled": true,
      autoCloseBrackets: "([{",
    });
    expect(commandOverrides).toEqual({});
  });

  test("parses command.update lines", async () => {
    const block = `command.update { name = "Some: Command", key = "Ctrl-x", mac = "Cmd-x" }
command.update { name = "Other", key = "Ctrl-y" }`;
    const { commandOverrides } = await parseManagedBlock(block);
    expect(commandOverrides).toEqual({
      "Some: Command": { key: "Ctrl-x", mac: "Cmd-x" },
      Other: { key: "Ctrl-y" },
    });
  });

  test("parses multi-stroke chord bindings", async () => {
    const block = `command.update { name = "Save All", key = "Ctrl-x Ctrl-s", mac = "Cmd-x Cmd-s" }`;
    const { commandOverrides } = await parseManagedBlock(block);
    expect(commandOverrides).toEqual({
      "Save All": { key: "Ctrl-x Ctrl-s", mac: "Cmd-x Cmd-s" },
    });
  });

  test("parses array bindings", async () => {
    const block = `command.update { name = "Search", key = { "Ctrl-f", "Mod-s" }, mac = { "Cmd-f" } }`;
    const { commandOverrides } = await parseManagedBlock(block);
    expect(commandOverrides).toEqual({
      Search: { key: ["Ctrl-f", "Mod-s"], mac: ["Cmd-f"] },
    });
  });

  test("parses mixed scalar and array fields", async () => {
    const block = `command.update { name = "Mixed", key = "Ctrl-a", mac = { "Cmd-a", "Cmd-A" } }`;
    const { commandOverrides } = await parseManagedBlock(block);
    expect(commandOverrides).toEqual({
      Mixed: { key: "Ctrl-a", mac: ["Cmd-a", "Cmd-A"] },
    });
  });

  test("tolerates comments, including ones that look like statements", async () => {
    const block = `-- managed-by: configuration-manager
-- config.set("commented", 1)
--[[
config.set("long", 2)
]]
config.set("a", 1) -- trailing
command.update { name = "X", key = "Ctrl-x" } -- trailing`;
    const { configOverrides, commandOverrides } =
      await parseManagedBlock(block);
    expect(configOverrides).toEqual({ a: 1 });
    expect(commandOverrides).toEqual({ X: { key: "Ctrl-x" } });
  });

  test("does not match config.set inside a string literal", async () => {
    const block = `config.set("s", 'config.set("inner", 1)')
config.set("t", [[
command.update { name = "Y", key = "Ctrl-y" }
]])`;
    const { configOverrides, commandOverrides } =
      await parseManagedBlock(block);
    expect(configOverrides).toEqual({
      s: 'config.set("inner", 1)',
      t: 'command.update { name = "Y", key = "Ctrl-y" }\n',
    });
    expect(commandOverrides).toEqual({});
  });

  test("handles any string syntax in command names and keys", async () => {
    const block = `command.update { name = 'Say "hi"', key = { 'Ctrl-"' } }`;
    expect((await parseManagedBlock(block)).commandOverrides).toEqual({
      'Say "hi"': { key: ['Ctrl-"'] },
    });
  });

  test("reports non-literal values as undefined", async () => {
    const block = `config.set("a", foo.bar)
config.set("b", 1 + 2)
config.set("c", true)`;
    expect((await parseManagedBlock(block)).configOverrides).toEqual({
      a: undefined,
      b: undefined,
      c: true,
    });
  });

  test("keeps name/key/mac of a command.update with non-literal fields", async () => {
    const block = `command.update { name = "X", key = "Ctrl-x", run = function() end, mac = foo }`;
    const parsed = await parseManagedBlock(block);
    expect(parsed.commandOverrides).toEqual({ X: { key: "Ctrl-x" } });
  });

  test("reports invalid Lua as an error", async () => {
    const parsed = await parseManagedBlock(
      `config.set("a", 1)\nconfig.set("b", {`,
    );
    expect(parsed.error).toMatch(/.+/);
    expect(parsed.configOverrides).toEqual({});
    expect(parsed.commandOverrides).toEqual({});
  });

  test("reports no error for a valid block", async () => {
    expect((await parseManagedBlock(`config.set("a", 1)`)).error).toBe(
      undefined,
    );
  });
});

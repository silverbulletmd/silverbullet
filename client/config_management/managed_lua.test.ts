import { describe, expect, test } from "vitest";
import { parseManagedBlock, toLua } from "./managed_lua.ts";

/** The value of a literal as read back from a managed `config.set` line. */
function literal(s: string): any {
  return parseManagedBlock(`config.set("x", ${s})`).configOverrides.x;
}

describe("toLua", () => {
  test("booleans", () => {
    expect(toLua(true)).toBe("true");
    expect(toLua(false)).toBe("false");
  });

  test("numbers", () => {
    expect(toLua(42)).toBe("42");
    expect(toLua(3.14)).toBe("3.14");
    expect(toLua(-1)).toBe("-1");
    expect(toLua(0)).toBe("0");
  });

  test("simple strings", () => {
    expect(toLua("hello")).toBe('"hello"');
    expect(toLua("")).toBe('""');
  });

  test("strings with special characters", () => {
    expect(toLua('say "hi"')).toBe('"say \\"hi\\""');
    expect(toLua("back\\slash")).toBe('"back\\\\slash"');
    expect(toLua("line\nbreak")).toBe('"line\\nbreak"');
    expect(toLua("tab\there")).toBe('"tab\\there"');
  });

  test("flat object", () => {
    expect(toLua({ enabled: true, name: "test" })).toBe(
      '{\n  enabled = true,\n  name = "test",\n}',
    );
  });

  test("nested object", () => {
    const val = { smartQuotes: { enabled: true, double: { left: "\u201c" } } };
    const result = toLua(val);
    expect(result).toContain("smartQuotes = {");
    expect(result).toContain("enabled = true");
    expect(result).toContain("double = {");
  });

  test("empty object", () => {
    expect(toLua({})).toBe("{}");
  });

  test("array", () => {
    expect(toLua(["a", "b"])).toBe('{\n  "a",\n  "b",\n}');
  });

  test("non-finite numbers serialize as nil", () => {
    expect(toLua(Number.NaN)).toBe("nil");
    expect(toLua(Number.POSITIVE_INFINITY)).toBe("nil");
    expect(toLua([1, Number.NEGATIVE_INFINITY])).toBe("{\n  1,\n  nil,\n}");
  });

  test("an empty array serializes as an empty table and parses back as {}", () => {
    // Lua cannot distinguish an empty array from an empty table
    expect(toLua([])).toBe("{}");
    expect(literal(toLua([]))).toEqual({});
  });

  test("null and undefined are skipped in objects", () => {
    expect(toLua({ a: 1, b: null, c: undefined })).toBe("{a = 1}");
  });
});

describe("literal values", () => {
  test("scalars", () => {
    expect(literal("true")).toBe(true);
    expect(literal("false")).toBe(false);
    expect(literal("nil")).toBe(undefined);
    expect(literal("42")).toBe(42);
    expect(literal("-3.14")).toBe(-3.14);
    expect(literal('"hello"')).toBe("hello");
    expect(literal('""')).toBe("");
  });

  test("returns undefined for unsupported shapes", () => {
    expect(literal("foo.bar")).toBe(undefined);
    expect(literal('{ "a", ')).toBe(undefined);
    expect(literal("{ 1, a = 2 }")).toBe(undefined);
    expect(literal("1 2")).toBe(undefined);
  });

  test("ignores surrounding whitespace", () => {
    expect(literal("  true  ")).toBe(true);
    expect(literal('  "x"  ')).toBe("x");
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
    test(`${JSON.stringify(value) ?? "undefined"}`, () => {
      expect(literal(toLua(value))).toBe(value);
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
    test(JSON.stringify(value), () => {
      expect(literal(toLua(value))).toEqual(value);
    });
  }

  test("accepts inline whitespace and no trailing comma", () => {
    expect(literal('{ "a", "b" }')).toEqual(["a", "b"]);
    expect(literal('{ x = 1, ["y z"] = {"q"} }')).toEqual({
      x: 1,
      "y z": ["q"],
    });
    expect(literal("{}")).toEqual({});
  });

  test("accepts any Lua literal syntax", () => {
    expect(literal("'single'")).toBe("single");
    expect(literal("[[long\nstring]]")).toBe("long\nstring");
    expect(literal("{ 1; 2 }")).toEqual([1, 2]);
    expect(literal("{ a = 1, -- note\n b = 2 }")).toEqual({
      a: 1,
      b: 2,
    });
  });

  test("rejects anything that is not exactly one literal", () => {
    expect(literal("1, 2")).toBe(undefined);
    expect(literal("{ [1] = 2 }")).toBe(undefined);
    expect(literal("{ f() }")).toBe(undefined);
  });
});

describe("parseManagedBlock", () => {
  test("multi-line table overrides alongside scalars and commands", () => {
    const block = `-- managed-by: configuration-manager
config.set("flag", true)
config.set("share.spaces", ${toLua(["https://h/a", "https://h/b"])})
config.set("obj", ${toLua({ k: { z: [1, 2] } })})
command.update { name = "Foo: Bar", key = "Ctrl-f" }
config.set("after", "x")`;
    const { configOverrides, commandOverrides } = parseManagedBlock(block);
    expect(configOverrides).toEqual({
      flag: true,
      "share.spaces": ["https://h/a", "https://h/b"],
      obj: { k: { z: [1, 2] } },
      after: "x",
    });
    expect(commandOverrides).toEqual({ "Foo: Bar": { key: "Ctrl-f" } });
  });

  test("parses config.set lines", () => {
    const block = `-- managed-by: configuration-manager
config.set("shortWikiLinks", false)
config.set("smartQuotes.enabled", true)
config.set("autoCloseBrackets", "([{")`;
    const { configOverrides, commandOverrides } = parseManagedBlock(block);
    expect(configOverrides).toEqual({
      shortWikiLinks: false,
      "smartQuotes.enabled": true,
      autoCloseBrackets: "([{",
    });
    expect(commandOverrides).toEqual({});
  });

  test("parses command.update lines", () => {
    const block = `command.update { name = "Some: Command", key = "Ctrl-x", mac = "Cmd-x" }
command.update { name = "Other", key = "Ctrl-y" }`;
    const { commandOverrides } = parseManagedBlock(block);
    expect(commandOverrides).toEqual({
      "Some: Command": { key: "Ctrl-x", mac: "Cmd-x" },
      Other: { key: "Ctrl-y" },
    });
  });

  test("parses multi-stroke chord bindings", () => {
    const block = `command.update { name = "Save All", key = "Ctrl-x Ctrl-s", mac = "Cmd-x Cmd-s" }`;
    const { commandOverrides } = parseManagedBlock(block);
    expect(commandOverrides).toEqual({
      "Save All": { key: "Ctrl-x Ctrl-s", mac: "Cmd-x Cmd-s" },
    });
  });

  test("parses array bindings", () => {
    const block = `command.update { name = "Search", key = { "Ctrl-f", "Mod-s" }, mac = { "Cmd-f" } }`;
    const { commandOverrides } = parseManagedBlock(block);
    expect(commandOverrides).toEqual({
      Search: { key: ["Ctrl-f", "Mod-s"], mac: ["Cmd-f"] },
    });
  });

  test("parses mixed scalar and array fields", () => {
    const block = `command.update { name = "Mixed", key = "Ctrl-a", mac = { "Cmd-a", "Cmd-A" } }`;
    const { commandOverrides } = parseManagedBlock(block);
    expect(commandOverrides).toEqual({
      Mixed: { key: "Ctrl-a", mac: ["Cmd-a", "Cmd-A"] },
    });
  });

  test("tolerates comments, including ones that look like statements", () => {
    const block = `-- managed-by: configuration-manager
-- config.set("commented", 1)
--[[
config.set("long", 2)
]]
config.set("a", 1) -- trailing
command.update { name = "X", key = "Ctrl-x" } -- trailing`;
    const { configOverrides, commandOverrides } = parseManagedBlock(block);
    expect(configOverrides).toEqual({ a: 1 });
    expect(commandOverrides).toEqual({ X: { key: "Ctrl-x" } });
  });

  test("does not match config.set inside a string literal", () => {
    const block = `config.set("s", 'config.set("inner", 1)')
config.set("t", [[
command.update { name = "Y", key = "Ctrl-y" }
]])`;
    const { configOverrides, commandOverrides } = parseManagedBlock(block);
    expect(configOverrides).toEqual({
      s: 'config.set("inner", 1)',
      t: 'command.update { name = "Y", key = "Ctrl-y" }\n',
    });
    expect(commandOverrides).toEqual({});
  });

  test("handles any string syntax in command names and keys", () => {
    const block = `command.update { name = 'Say "hi"', key = { 'Ctrl-"' } }`;
    expect(parseManagedBlock(block).commandOverrides).toEqual({
      'Say "hi"': { key: ['Ctrl-"'] },
    });
  });

  test("reports non-literal values as undefined", () => {
    const block = `config.set("a", foo.bar)
config.set("b", 1 + 2)
config.set("c", true)`;
    expect(parseManagedBlock(block).configOverrides).toEqual({
      a: undefined,
      b: undefined,
      c: true,
    });
  });

  test("keeps name/key/mac of a command.update with non-literal fields", () => {
    const block = `command.update { name = "X", key = "Ctrl-x", run = function() end, mac = foo }`;
    const parsed = parseManagedBlock(block);
    expect(parsed.commandOverrides).toEqual({ X: { key: "Ctrl-x" } });
  });

  test("reports invalid Lua as an error", () => {
    const parsed = parseManagedBlock(`config.set("a", 1)\nconfig.set("b", {`);
    expect(parsed.error).toMatch(/.+/);
    expect(parsed.configOverrides).toEqual({});
    expect(parsed.commandOverrides).toEqual({});
  });

  test("reports no error for a valid block", () => {
    expect(parseManagedBlock(`config.set("a", 1)`).error).toBe(undefined);
  });
});

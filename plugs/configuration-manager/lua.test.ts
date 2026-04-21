import { describe, expect, test } from "vitest";
import { parseLuaLiteral, parseManagedBlock, toLua, toLuaKey } from "./lua.ts";

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

  test("null and undefined are skipped in objects", () => {
    expect(toLua({ a: 1, b: null, c: undefined })).toBe("{\n  a = 1,\n}");
  });
});

describe("toLuaKey", () => {
  test("simple identifiers", () => {
    expect(toLuaKey("name")).toBe("name");
    expect(toLuaKey("enabled")).toBe("enabled");
  });

  test("keys needing brackets", () => {
    expect(toLuaKey("my-key")).toBe('["my-key"]');
    expect(toLuaKey("123")).toBe('["123"]');
    expect(toLuaKey("has space")).toBe('["has space"]');
  });
});

describe("parseLuaLiteral", () => {
  test("scalars", () => {
    expect(parseLuaLiteral("true")).toBe(true);
    expect(parseLuaLiteral("false")).toBe(false);
    expect(parseLuaLiteral("nil")).toBe(undefined);
    expect(parseLuaLiteral("42")).toBe(42);
    expect(parseLuaLiteral("-3.14")).toBe(-3.14);
    expect(parseLuaLiteral('"hello"')).toBe("hello");
    expect(parseLuaLiteral('""')).toBe("");
  });

  test("returns undefined for unsupported shapes", () => {
    expect(parseLuaLiteral("{}")).toBe(undefined);
    expect(parseLuaLiteral('"has \\"quote\\""')).toBe(undefined);
  });

  test("ignores surrounding whitespace", () => {
    expect(parseLuaLiteral("  true  ")).toBe(true);
    expect(parseLuaLiteral('  "x"  ')).toBe("x");
  });
});

describe("toLua / parseLuaLiteral round-trip (supported scalars)", () => {
  // Only round-trips scalars: parseLuaLiteral does not parse tables.
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
      expect(parseLuaLiteral(toLua(value))).toBe(value);
    });
  }
});

describe("parseManagedBlock", () => {
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
      "Other": { key: "Ctrl-y" },
    });
  });

  test("parses multi-stroke chord bindings", () => {
    const block =
      `command.update { name = "Save All", key = "Ctrl-x Ctrl-s", mac = "Cmd-x Cmd-s" }`;
    const { commandOverrides } = parseManagedBlock(block);
    expect(commandOverrides).toEqual({
      "Save All": { key: "Ctrl-x Ctrl-s", mac: "Cmd-x Cmd-s" },
    });
  });

  test("parses array bindings", () => {
    const block =
      `command.update { name = "Search", key = { "Ctrl-f", "Mod-s" }, mac = { "Cmd-f" } }`;
    const { commandOverrides } = parseManagedBlock(block);
    expect(commandOverrides).toEqual({
      "Search": { key: ["Ctrl-f", "Mod-s"], mac: ["Cmd-f"] },
    });
  });

  test("parses mixed scalar and array fields", () => {
    const block =
      `command.update { name = "Mixed", key = "Ctrl-a", mac = { "Cmd-a", "Cmd-A" } }`;
    const { commandOverrides } = parseManagedBlock(block);
    expect(commandOverrides).toEqual({
      "Mixed": { key: "Ctrl-a", mac: ["Cmd-a", "Cmd-A"] },
    });
  });

  test("round-trips the shape saveConfiguration emits", () => {
    const configOverrides = {
      shortWikiLinks: false,
      "smartQuotes.enabled": true,
      autoCloseBrackets: "([{",
    };
    const commandOverrides: Record<
      string,
      { key?: string | string[]; mac?: string | string[] }
    > = {
      "Some: Command": { key: "Ctrl-x", mac: "Cmd-x" },
      "Chord Cmd": { key: "Ctrl-x Ctrl-s", mac: "Cmd-x Cmd-s" },
      "Array Cmd": { key: ["Ctrl-y", "Ctrl-Y"] },
      "Other": { key: "Ctrl-y" },
    };

    const lines: string[] = ["-- managed-by: configuration-manager"];
    for (const [path, value] of Object.entries(configOverrides)) {
      lines.push(`config.set(${toLua(path)}, ${toLua(value)})`);
    }
    for (const [name, override] of Object.entries(commandOverrides)) {
      const parts = [`name = ${toLua(name)}`];
      if (override.key !== undefined) parts.push(`key = ${toLua(override.key)}`);
      if (override.mac !== undefined) parts.push(`mac = ${toLua(override.mac)}`);
      lines.push(`command.update { ${parts.join(", ")} }`);
    }

    const parsed = parseManagedBlock(lines.join("\n"));
    expect(parsed.configOverrides).toEqual(configOverrides);
    expect(parsed.commandOverrides).toEqual(commandOverrides);
  });
});

import { describe, expect, test } from "vitest";
import { toLua, toLuaKey } from "./lua_serialize.ts";

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

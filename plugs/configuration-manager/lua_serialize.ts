const LUA_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Format a key for use in a Lua table constructor.
 * Simple identifiers use bare `key =`, others use `["key"] =`.
 */
export function toLuaKey(key: string): string {
  return LUA_IDENTIFIER.test(key) ? key : `["${escapeLuaString(key)}"]`;
}

function escapeLuaString(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally escaping control chars for Lua output
    .replace(/[\x00-\x1f]/g, (ch) => {
      return `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
    });
}

/**
 * Serialize a JavaScript value to Lua source code.
 */
export function toLua(value: unknown, indent = 0): string {
  if (value === null || value === undefined) {
    return "nil";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return `"${escapeLuaString(value)}"`;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return "{}";
    const pad = "  ".repeat(indent + 1);
    const items = value.map((v) => `${pad}${toLua(v, indent + 1)},`);
    return `{\n${items.join("\n")}\n${"  ".repeat(indent)}}`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value).filter(
      ([_, v]) => v !== null && v !== undefined,
    );
    if (entries.length === 0) return "{}";
    const pad = "  ".repeat(indent + 1);
    const items = entries.map(
      ([k, v]) => `${pad}${toLuaKey(k)} = ${toLua(v, indent + 1)},`,
    );
    return `{\n${items.join("\n")}\n${"  ".repeat(indent)}}`;
  }
  return "nil";
}

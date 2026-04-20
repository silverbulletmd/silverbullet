/**
 * Note: yes, this duplicates functionality also found in the Space Lua implementation,
 * for pragmatic reasons. Pulling in the entiretly of this library into this plug would
 * be overkill. We only need a few serialization features in practice.
 */

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

/**
 * Parse a single Lua literal as emitted by toLua().
 * Only handles the scalar literals (boolean, number, simple string, nil).
 * Complex values (tables) are not supported and return undefined.
 */
export function parseLuaLiteral(s: string): any {
  s = s.trim();
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "nil") return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const strMatch = s.match(/^"([^"]*)"$/);
  if (strMatch) return strMatch[1];
  return undefined;
}

/**
 * Parse the body of the configuration-manager managed block back into the
 * structured form the UI consumes. Only recognizes the exact shapes emitted by
 * the manager: `config.set("path", literal)` and
 * `command.update { name = "...", key = "...", mac = "..." }`.
 *
 * The regexes assume strings without embedded quotes, braces, or parens — the
 * same constraints toLua() respects when emitting these blocks.
 */
export function parseManagedBlock(blockContent: string): {
  configOverrides: Record<string, any>;
  commandOverrides: Record<string, { key?: string; mac?: string }>;
} {
  const configOverrides: Record<string, any> = {};
  const commandOverrides: Record<string, { key?: string; mac?: string }> = {};

  const configRe = /config\.set\("([^"]+)",\s*(.+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = configRe.exec(blockContent)) !== null) {
    configOverrides[m[1]] = parseLuaLiteral(m[2]);
  }

  const cmdRe = /command\.update\s*\{([^}]+)\}/g;
  while ((m = cmdRe.exec(blockContent)) !== null) {
    const body = m[1];
    const nameMatch = body.match(/name\s*=\s*"([^"]*)"/);
    if (!nameMatch) continue;
    const name = nameMatch[1];
    const entry: { key?: string; mac?: string } = {};
    const keyMatch = body.match(/key\s*=\s*"([^"]*)"/);
    const macMatch = body.match(/mac\s*=\s*"([^"]*)"/);
    if (keyMatch) entry.key = keyMatch[1];
    if (macMatch) entry.mac = macMatch[1];
    commandOverrides[name] = entry;
  }

  return { configOverrides, commandOverrides };
}

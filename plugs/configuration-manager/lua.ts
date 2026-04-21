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
  return (
    s
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"')
      .replace(/\n/g, "\\n")
      .replace(/\t/g, "\\t")
      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally escaping control chars for Lua output
      .replace(/[\x00-\x1f]/g, (ch) => {
        return `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`;
      })
  );
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

export type CommandOverride = {
  key?: string | string[];
  mac?: string | string[];
};

/**
 * Parse a `key = "..."` or `key = { "a", "b" }` field out of a command.update
 * body. Returns undefined if the field isn't present.
 */
function parseStringOrList(
  body: string,
  field: string,
): string | string[] | undefined {
  const scalarRe = new RegExp(`\\b${field}\\s*=\\s*"([^"]*)"`);
  const scalar = body.match(scalarRe);
  if (scalar) return scalar[1];
  const listRe = new RegExp(`\\b${field}\\s*=\\s*\\{([^}]*)\\}`);
  const list = body.match(listRe);
  if (!list) return undefined;
  const items: string[] = [];
  const itemRe = /"([^"]*)"/g;
  let im: RegExpExecArray | null;
  while ((im = itemRe.exec(list[1])) !== null) items.push(im[1]);
  return items;
}

/**
 * Parse the body of the configuration-manager managed block back into the
 * structured form the UI consumes. Only recognizes the exact shapes emitted by
 * the manager: `config.set("path", literal)` and
 * `command.update { name = "...", key = ..., mac = ... }`, where key/mac are
 * either string literals or `{ "a", "b" }` string lists.
 *
 * Strings with embedded quotes/braces/parens are not supported — matches the
 * constraints toLua() respects when emitting these blocks.
 */
export function parseManagedBlock(blockContent: string): {
  configOverrides: Record<string, any>;
  commandOverrides: Record<string, CommandOverride>;
} {
  const configOverrides: Record<string, any> = {};
  const commandOverrides: Record<string, CommandOverride> = {};

  const configRe = /config\.set\("([^"]+)",\s*(.+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = configRe.exec(blockContent)) !== null) {
    configOverrides[m[1]] = parseLuaLiteral(m[2]);
  }

  // Scan for `command.update {...}` with brace-depth tracking so nested
  // string lists like `key = { "a", "b" }` don't truncate the match early.
  const needle = "command.update";
  let idx = 0;
  while (true) {
    const start = blockContent.indexOf(needle, idx);
    if (start === -1) break;
    let i = start + needle.length;
    while (i < blockContent.length && /\s/.test(blockContent[i])) i++;
    if (blockContent[i] !== "{") {
      idx = start + needle.length;
      continue;
    }
    let depth = 0;
    let bodyStart = i + 1;
    let bodyEnd = -1;
    for (; i < blockContent.length; i++) {
      const ch = blockContent[i];
      if (ch === '"') {
        i++;
        while (i < blockContent.length && blockContent[i] !== '"') {
          if (blockContent[i] === "\\") i++;
          i++;
        }
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          bodyEnd = i;
          break;
        }
      }
    }
    if (bodyEnd === -1) break;
    const body = blockContent.slice(bodyStart, bodyEnd);
    idx = bodyEnd + 1;

    const nameMatch = body.match(/\bname\s*=\s*"([^"]*)"/);
    if (!nameMatch) continue;
    const entry: CommandOverride = {};
    const key = parseStringOrList(body, "key");
    const mac = parseStringOrList(body, "mac");
    if (key !== undefined) entry.key = key;
    if (mac !== undefined) entry.mac = mac;
    commandOverrides[nameMatch[1]] = entry;
  }

  return { configOverrides, commandOverrides };
}

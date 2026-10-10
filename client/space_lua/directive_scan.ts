/**
 * Index just past the `}` closing the `${…}` that starts at `start`, or -1.
 * Braces inside Lua strings, long brackets and comments don't count. When the
 * body doesn't scan as Lua (e.g. an unterminated string while typing), plain
 * brace counting decides, as the parser did before it understood Lua.
 */
export function scanLuaDirectiveEnd(text: string, start: number): number {
  if (text[start] !== "$" || text[start + 1] !== "{") return -1;
  const end = scanLuaTokens(text, start);
  return end >= 0 ? end : scanBraces(text, start);
}

function scanBraces(text: string, start: number): number {
  let depth = 0;
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

// `query [[ … ]]` holds Lua tokens (strings may contain `]]`), not a long string
const QUERY_BEFORE_RE = /(^|[^\w.:])query\s*$/;

function scanLuaTokens(text: string, start: number): number {
  let depth = 0;
  let i = start + 1;
  while (i < text.length) {
    const c = text[i];
    if (c === "{") {
      depth++;
      i++;
    } else if (c === "}") {
      depth--;
      i++;
      if (depth === 0) return i;
    } else if (c === '"' || c === "'") {
      i = skipQuoted(text, i);
      if (i < 0) return -1;
    } else if (c === "[") {
      if (
        text[i + 1] === "[" &&
        QUERY_BEFORE_RE.test(text.slice(Math.max(start, i - 64), i))
      ) {
        i += 2;
        continue;
      }
      const after = skipLongBracket(text, i);
      if (after === -2) return -1;
      i = after > 0 ? after : i + 1;
    } else if (c === "-" && text[i + 1] === "-") {
      const after = skipLongBracket(text, i + 2);
      if (after === -2) return -1;
      if (after > 0) {
        i = after;
      } else {
        const nl = text.indexOf("\n", i);
        i = nl < 0 ? text.length : nl;
      }
    } else {
      i++;
    }
  }
  return -1;
}

/**
 * Whether `offset` falls inside a `${…}` that starts earlier in `text`,
 * including one not yet closed (e.g. mid-typing an unterminated string).
 */
export function isInsideLuaDirective(text: string, offset: number): boolean {
  let start = text.indexOf("${");
  while (start >= 0 && start < offset) {
    const end = scanLuaDirectiveEnd(text, start);
    if (end < 0 || end > offset) return true;
    start = text.indexOf("${", end);
  }
  return false;
}

function skipQuoted(text: string, i: number): number {
  const quote = text[i];
  i++;
  while (i < text.length) {
    const c = text[i];
    if (c === "\\") {
      i += 2;
    } else if (c === quote) {
      return i + 1;
    } else if (c === "\n") {
      return -1;
    } else {
      i++;
    }
  }
  return -1;
}

// -1: not a long-bracket opener; -2: opener without a closer
function skipLongBracket(text: string, i: number): number {
  const m = /^\[(=*)\[/.exec(text.slice(i, i + 32));
  if (!m) return -1;
  const close = `]${m[1]}]`;
  const end = text.indexOf(close, i + m[0].length);
  return end < 0 ? -2 : end + close.length;
}

/** GFM unescapes `\|` inside table cells; apply the same to directives there. */
export function unescapeTableCellPipes(expr: string): string {
  return expr.replaceAll("\\|", "|");
}

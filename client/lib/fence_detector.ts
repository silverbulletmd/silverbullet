/**
 * Detect the set of fenced-code block info strings present in a markdown
 * document. Used by the Pass-1 boot indexer to identify pages that contain
 * `space-lua` or `space-style` fences without doing a full markdown parse.
 *
 * Implements CommonMark fenced-code rules:
 *   - opening fence: 0..3 leading spaces, then 3+ backticks or 3+ tildes,
 *     optional info string on the same line
 *   - closing fence: same character, length >= opening length, optional
 *     trailing whitespace
 *   - the closing fence character must match the opening (backtick fences
 *     cannot close a tilde fence and vice versa)
 *
 * The info string is lowercased and trimmed at the first whitespace.
 * Empty info strings are not added to the result set.
 */

export function detectFences(text: string): Set<string> {
  const types = new Set<string>();
  const lines = text.split("\n");
  let openLevel = 0;
  let openChar = "";

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");
    if (openLevel === 0) {
      const open = parseFenceOpen(line);
      if (open) {
        openLevel = open.level;
        openChar = open.char;
        if (open.info.length > 0) {
          types.add(open.info);
        }
      }
    } else if (isFenceClose(line, openChar, openLevel)) {
      openLevel = 0;
      openChar = "";
    }
  }
  return types;
}

export function hasFence(text: string, type: string): boolean {
  const target = type.toLowerCase();
  return detectFences(text).has(target);
}

export function hasAnyFence(text: string, types: readonly string[]): boolean {
  const detected = detectFences(text);
  for (const t of types) {
    if (detected.has(t.toLowerCase())) return true;
  }
  return false;
}

function parseFenceOpen(
  line: string,
): { level: number; char: string; info: string } | null {
  let i = 0;
  while (i < line.length && i < 3 && line.charCodeAt(i) === 0x20) i++;

  const ch = line[i];
  if (ch !== "`" && ch !== "~") return null;

  let level = 0;
  while (i < line.length && line[i] === ch) {
    level++;
    i++;
  }
  if (level < 3) return null;

  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;

  let infoFull = "";
  while (i < line.length && line[i] !== " " && line[i] !== "\t") {
    infoFull += line[i];
    i++;
  }

  if (ch === "`" && infoFull.includes("`")) {
    return null;
  }

  return { level, char: ch, info: infoFull.toLowerCase() };
}

function isFenceClose(line: string, openChar: string, openLevel: number): boolean {
  let i = 0;
  while (i < line.length && i < 3 && line.charCodeAt(i) === 0x20) i++;

  if (line[i] !== openChar) return false;

  let level = 0;
  while (i < line.length && line[i] === openChar) {
    level++;
    i++;
  }
  if (level < openLevel) return false;

  while (i < line.length && (line[i] === " " || line[i] === "\t")) i++;
  return i === line.length;
}

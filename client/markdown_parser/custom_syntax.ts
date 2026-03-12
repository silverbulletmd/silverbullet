import type { MarkdownConfig } from "@lezer/markdown";

export type CustomSyntaxSpec = {
  // AST node name, also used to derive child node names (e.g. "LatexInline" -> "LatexInlineMark", "LatexInlineBody")
  name: string;
  // Regex string matched at the start of the syntax region (e.g. "\\$" for a single $)
  startMarker: string;
  // Regex string matched at the end of the syntax region
  endMarker: string;
  // "inline" for within-paragraph syntax, "block" for multi-line fenced regions
  mode: "inline" | "block";
};

export type CustomSyntaxSpecs = Record<string, CustomSyntaxSpec>;

export function buildCustomInlineParser(
  spec: CustomSyntaxSpec,
): MarkdownConfig {
  const { name, startMarker, endMarker } = spec;
  let startRegex: RegExp;
  let endRegex: RegExp;
  try {
    startRegex = new RegExp(startMarker, "y");
    endRegex = new RegExp(endMarker, "g");
  } catch (e) {
    console.warn(`Custom syntax "${name}": invalid regex, skipping`, e);
    return { defineNodes: [], parseInline: [] };
  }

  // Pre-compute the first char code for fast rejection
  // Generate a literal prefix from the regex source to get the first char
  const firstCharCode = literalPrefixCharCode(startMarker);

  return {
    defineNodes: [{ name }, { name: `${name}Mark` }, { name: `${name}Body` }],
    parseInline: [
      {
        name,
        parse(cx, next, pos) {
          // Fast rejection by first character
          if (firstCharCode !== null && next !== firstCharCode) {
            return -1;
          }

          const textFromPos = cx.slice(pos, cx.end);

          // Match start marker at current position
          startRegex.lastIndex = 0;
          const startMatch = startRegex.exec(textFromPos);
          if (!startMatch) {
            return -1;
          }
          const startLen = startMatch[0].length;

          // Search for end marker after start marker, skipping escaped occurrences
          endRegex.lastIndex = startLen;
          let endMatch: RegExpExecArray | null = null;
          while ((endMatch = endRegex.exec(textFromPos))) {
            const matchPos = endMatch.index;
            let backslashCount = 0;
            for (
              let i = matchPos - 1;
              i >= startLen && textFromPos[i] === "\\";
              i--
            ) {
              backslashCount++;
            }
            if (backslashCount % 2 === 0) {
              break; // Even backslashes (or zero) — real end marker
            }
            // Odd backslashes — escaped, keep searching
          }
          if (!endMatch) {
            return -1;
          }

          const bodyStart = pos + startLen;
          const bodyEnd = pos + endMatch.index;
          const endPos = pos + endMatch.index + endMatch[0].length;

          return cx.addElement(
            cx.elt(name, pos, endPos, [
              cx.elt(`${name}Mark`, pos, pos + startLen),
              cx.elt(`${name}Body`, bodyStart, bodyEnd),
              cx.elt(`${name}Mark`, bodyEnd, endPos),
            ]),
          );
        },
        after: "Emphasis",
      },
    ],
  };
}

export function buildCustomBlockParser(spec: CustomSyntaxSpec): MarkdownConfig {
  const { name, startMarker, endMarker } = spec;
  let startRegex: RegExp;
  let endRegex: RegExp;
  try {
    startRegex = new RegExp(startMarker);
    endRegex = new RegExp(endMarker);
  } catch (e) {
    console.warn(`Custom syntax "${name}": invalid regex, skipping`, e);
    return { defineNodes: [], parseBlock: [] };
  }

  return {
    defineNodes: [
      { name, block: true },
      { name: `${name}Mark` },
      { name: `${name}Body` },
    ],
    parseBlock: [
      {
        name,
        parse(cx, line) {
          const startMatch = startRegex.exec(line.text);
          if (!startMatch) {
            return false;
          }

          const blockStart = cx.parsedPos;
          const elts = [
            cx.elt(
              `${name}Mark`,
              cx.parsedPos,
              cx.parsedPos + line.text.length,
            ),
          ];

          cx.nextLine();

          const bodyStart = cx.parsedPos;
          let bodyEnd = bodyStart;
          let lastPos = cx.parsedPos;

          while (!endRegex.exec(line.text)) {
            bodyEnd = cx.parsedPos + line.text.length + 1;
            cx.nextLine();
            if (cx.parsedPos === lastPos) {
              // End of file without end marker — no match
              return false;
            }
            lastPos = cx.parsedPos;
          }

          // bodyEnd points past the last body line
          if (bodyStart < bodyEnd) {
            // Remove trailing newline from body
            elts.push(cx.elt(`${name}Body`, bodyStart, bodyEnd - 1));
          } else {
            // Empty body
            elts.push(cx.elt(`${name}Body`, bodyStart, bodyStart));
          }

          const endMarkStart = cx.parsedPos;
          const endMarkEnd = cx.parsedPos + line.text.length;
          elts.push(cx.elt(`${name}Mark`, endMarkStart, endMarkEnd));

          cx.nextLine();
          cx.addElement(cx.elt(name, blockStart, endMarkEnd, elts));
          return true;
        },
        before: "HorizontalRule",
      },
    ],
  };
}

export function buildCustomSyntaxExtensions(
  specs: CustomSyntaxSpecs,
): MarkdownConfig[] {
  const configs: MarkdownConfig[] = [];
  for (const spec of Object.values(specs)) {
    try {
      if (spec.mode === "inline") {
        configs.push(buildCustomInlineParser(spec));
      } else if (spec.mode === "block") {
        configs.push(buildCustomBlockParser(spec));
      } else {
        console.warn(
          `Custom syntax "${spec.name}": unknown mode "${spec.mode}"`,
        );
      }
    } catch (e) {
      console.warn(`Custom syntax "${spec.name}": error building parser`, e);
    }
  }
  return configs;
}

/**
 * Extract the char code of the first literal character from a regex source string.
 * Returns null if the regex starts with a metacharacter.
 */
function literalPrefixCharCode(regexSource: string): number | null {
  if (!regexSource) return null;
  const first = regexSource[0];
  // If it's an escape sequence, use the escaped char
  if (first === "\\") {
    if (regexSource.length < 2) return null;
    const escaped = regexSource[1];
    // Only literal escapes (not \d, \w, etc.)
    if (/[dDwWsSbB]/.test(escaped)) return null;
    return escaped.charCodeAt(0);
  }
  // Metacharacters that don't match a literal first char
  if (/[.^$*+?({[|]/.test(first)) return null;
  return first.charCodeAt(0);
}

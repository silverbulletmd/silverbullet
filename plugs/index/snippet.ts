/**
 * Pre-computed line data for efficient repeated snippet extraction from the same text.
 */
export interface LineIndex {
  lines: string[];
  // Cumulative character offsets: lineOffsets[i] = char position where line i starts
  lineOffsets: number[];
}

/**
 * Build a LineIndex for a given text, allowing multiple extractSnippet calls
 * without repeatedly splitting the text.
 */
export function buildLineIndex(text: string): LineIndex {
  const lines = text.split("\n");
  const lineOffsets: number[] = new Array(lines.length);
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineOffsets[i] = offset;
    offset += lines[i].length + 1; // +1 for the newline
  }
  return { lines, lineOffsets };
}

/**
 * Extracts a snippet around a given index in markdown text based on indentation rules.
 *
 * If the line at the given index is indented, the snippet will include:
 * - The entire line containing the index
 * - All subsequent lines with indentation level greater than the current line
 *
 * @param pageName - The name of the page
 * @param textOrLineIndex - The full markdown text or a pre-computed LineIndex
 * @param index - The position within the text where extraction should be centered
 * @param maxLines - Maximum number of lines to include in the snippet (default: 10)
 * @returns The extracted snippet
 */
export function extractSnippet(
  pageName: string,
  textOrLineIndex: string | LineIndex,
  index: number,
  maxLines: number = 10,
): string {
  let lines: string[];
  let lineOffsets: number[];

  if (typeof textOrLineIndex === "string") {
    const li = buildLineIndex(textOrLineIndex);
    lines = li.lines;
    lineOffsets = li.lineOffsets;
  } else {
    lines = textOrLineIndex.lines;
    lineOffsets = textOrLineIndex.lineOffsets;
  }

  // Binary search for the target line
  let lo = 0;
  let hi = lines.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid] <= index) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const targetLineIndex = lo;

  const targetLine = lines[targetLineIndex];
  const targetIndent = getIndentationLevel(targetLine);

  // Start with the target line
  const snippetLines = [targetLine.substring(targetIndent)];

  // Add all subsequent lines that have greater indentation than the target line
  for (let i = targetLineIndex + 1; i < lines.length; i++) {
    let line = lines[i];
    const lineIndent = getIndentationLevel(line);

    if (snippetLines.length >= maxLines) {
      snippetLines.push("...");
      break;
    }

    // Stop if we hit an empty line
    if (line.trim() === "") {
      break;
    }

    // Stop if we hit a line with indentation equal to or less than the target line
    if (lineIndent <= targetIndent) {
      break;
    }

    // Find tasks that don't have a page reference, and add one
    const taskMatch = line.match(/^(\s*)([*-]\s+\[[^\]]+\]\s+)([^[][^[].+)$/);
    if (taskMatch) {
      const pos = lineOffsets[i] + taskMatch[1].length;
      line = `${taskMatch[1] + taskMatch[2]}[[${pageName}@${pos}]] ${taskMatch[3]}`;
    }
    snippetLines.push(line.substring(targetIndent));
  }

  let result = snippetLines.join("\n");

  // Specific cases: because headers look bad in snippets, let's strip those leading `#`
  result = result.replace(/^(#+)\s+/, "");

  return result;
}

/**
 * Gets the indentation level of a line (number of leading spaces).
 *
 * @param line - The line to measure
 * @returns The number of leading spaces
 */
function getIndentationLevel(line: string): number {
  const match = line.match(/^( *)/);
  return match ? match[1].length : 0;
}

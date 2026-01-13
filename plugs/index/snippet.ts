/**
 * Extracts a snippet around a given index in markdown text based on indentation rules.
 *
 * If the line at the given index is indented, the snippet will include:
 * - The entire line containing the index
 * - All subsequent lines with indentation level greater than the current line
 *
 * @param text - The full markdown text
 * @param index - The position within the text where extraction should be centered
 * @param maxLines - Maximum number of lines to include in the snippet (default: Infinity)
 * @returns The extracted snippet
 */
export function extractSnippet(
  pageName: string,
  text: string,
  index: number,
  maxLines: number = 10,
): string {
  const lines = text.split("\n");
  const lineLengths = lines.map((line) => line.length);
  const targetLineIndex = text.substring(0, index).split("\n").length - 1;
  const targetLine = lines[targetLineIndex];
  const targetIndent = getIndentationLevel(targetLine);

  // Start with the target line
  const snippetLines = [targetLine.substring(targetIndent)];

  // Add all subsequent lines that have greater indentation than the target line
  for (
    let i = targetLineIndex + 1;
    i < lines.length;
    i++
  ) {
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
    const taskMatch = line.match(
      /^(\s*)([\*\-]\s+\[[^\]]+\]\s+)([^\[][^\[].+)$/,
    );
    if (taskMatch) {
      const pos = lineLengths.slice(0, i).reduce((acc, len) =>
        acc + len + 1, 0) +
        taskMatch[1].length;
      line = taskMatch[1] + taskMatch[2] + `[[${pageName}@${pos}]] ` +
        taskMatch[3];
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

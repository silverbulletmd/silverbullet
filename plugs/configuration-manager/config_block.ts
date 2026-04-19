export const MANAGED_MARKER = "-- managed-by: configuration-ui";

export interface ManagedBlock {
  /** Start index of the opening ``` fence line in the full text */
  start: number;
  /** End index (exclusive) of the closing ``` fence line */
  end: number;
  /** The content inside the fences (without the fences themselves) */
  innerContent: string;
}

/**
 * Find the managed space-lua block in a CONFIG.md text.
 * Returns null if no managed block exists.
 */
export function findManagedBlock(text: string): ManagedBlock | null {
  const fenceRegex = /^```space-lua\s*\n([\s\S]*?)^```\s*$/gm;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    const innerContent = match[1];
    if (innerContent.trimStart().startsWith(MANAGED_MARKER)) {
      return {
        start: match.index,
        end: match.index + match[0].length,
        innerContent,
      };
    }
  }
  return null;
}

/**
 * Replace the managed block in CONFIG.md text, or append one if none exists.
 * If newContent is empty, the managed block is removed.
 */
export function replaceManagedBlock(
  text: string,
  newContent: string,
): string {
  const existing = findManagedBlock(text);

  if (existing) {
    if (!newContent) {
      // Remove the block and any surrounding blank line
      let end = existing.end;
      if (text[end] === "\n") end++;
      let start = existing.start;
      if (start > 0 && text[start - 1] === "\n") start--;
      return text.slice(0, start) + text.slice(end);
    }
    const replacement = "```space-lua\n" + newContent + "\n```";
    return text.slice(0, existing.start) + replacement +
      text.slice(existing.end);
  }

  if (!newContent) return text;

  // Append new block at end
  const block = "```space-lua\n" + newContent + "\n```\n";
  const separator = text.endsWith("\n") ? "\n" : "\n\n";
  return text + separator + block;
}

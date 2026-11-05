export const MANAGED_MARKER = "-- managed-by: configuration-manager";
export const SCHEMAS_MARKER = "-- managed-by: workbench-schemas";

/** A kind of space-lua block in CONFIG that the Workbench maintains */
export type ManagedBlockKind = {
  /** First line of the block, which identifies it */
  marker: string;
  /** What a new block starts with */
  header: string;
  /** Names the block in messages */
  label: string;
  /** The block a new one is placed right after, when there is one */
  after?: ManagedBlockKind;
};

export const CONFIG_BLOCK: ManagedBlockKind = {
  marker: MANAGED_MARKER,
  header: MANAGED_MARKER,
  label: "configuration",
};

/**
 * Tag schemas the Workbench's Data tab maintains. It runs at priority -10,
 * after the built-in root tags (10) and ordinary scripts (0).
 */
export const SCHEMAS_BLOCK: ManagedBlockKind = {
  marker: SCHEMAS_MARKER,
  header: `${SCHEMAS_MARKER}\n-- priority: -10`,
  label: "schemas",
  after: CONFIG_BLOCK,
};

export type ManagedBlock = {
  /** Start index of the opening ``` fence line in the full text */
  start: number;
  /** End index (exclusive) of the closing ``` fence line */
  end: number;
  /** The content inside the fences (without the fences themselves) */
  innerContent: string;
};

/**
 * Find the managed space-lua block of a kind in a CONFIG.md text.
 * Returns null if no such block exists.
 */
export function findManagedBlock(
  text: string,
  kind: ManagedBlockKind = CONFIG_BLOCK,
): ManagedBlock | null {
  const fenceRegex = /^```space-lua[ \t]*\n([\s\S]*?)^```[ \t]*$/gm;
  let match: RegExpExecArray | null;
  while ((match = fenceRegex.exec(text)) !== null) {
    const innerContent = match[1];
    if (innerContent.trimStart().startsWith(kind.marker)) {
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
 * Replace the managed block of a kind in CONFIG.md text, or add one if none
 * exists: right after the `kind.after` block when there is one, else at
 * the end. If newContent is empty, the block is removed.
 */
export function replaceManagedBlock(
  text: string,
  newContent: string,
  kind: ManagedBlockKind = CONFIG_BLOCK,
): string {
  const existing = findManagedBlock(text, kind);

  if (existing) {
    if (!newContent) {
      // Remove the block and any surrounding blank line
      let end = existing.end;
      if (text[end] === "\n") end++;
      let start = existing.start;
      if (start > 0 && text[start - 1] === "\n") start--;
      return text.slice(0, start) + text.slice(end);
    }
    const replacement = `\`\`\`space-lua\n${newContent}\n\`\`\``;
    return (
      text.slice(0, existing.start) + replacement + text.slice(existing.end)
    );
  }

  if (!newContent) return text;

  const anchor = kind.after ? findManagedBlock(text, kind.after) : null;
  if (anchor) {
    const block = `\n\n\`\`\`space-lua\n${newContent}\n\`\`\``;
    return text.slice(0, anchor.end) + block + text.slice(anchor.end);
  }

  // Append new block at end
  const block = `\`\`\`space-lua\n${newContent}\n\`\`\`\n`;
  const separator = text.endsWith("\n") ? "\n" : "\n\n";
  return text + separator + block;
}

/**
 * Why a managed block that is not valid Lua can't be edited: its statements
 * can't be found, so saving could drop or duplicate what it holds.
 */
export function invalidManagedBlockMessage(
  detail: string,
  kind: ManagedBlockKind = CONFIG_BLOCK,
): string {
  return `The managed ${kind.label} block in CONFIG is not valid Lua, fix it there first: ${detail}`;
}

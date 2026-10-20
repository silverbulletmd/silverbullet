import {
  findManagedBlock,
  invalidManagedBlockMessage,
  MANAGED_MARKER,
  replaceManagedBlock,
} from "./config_block.ts";
import {
  type CommandOverride,
  type ManagedStatement,
  scanManagedStatements,
  toLua,
} from "./lua.ts";
import type { ManagedChanges } from "./overrides.ts";

async function configStatement(path: string, value: unknown): Promise<string> {
  return `config.set(${await toLua(path)}, ${await toLua(value)})`;
}

async function commandStatement(
  name: string,
  override: CommandOverride,
): Promise<string> {
  const parts = [`name = ${await toLua(name)}`];
  if (override.key !== undefined)
    parts.push(`key = ${await toLua(override.key)}`);
  if (override.mac !== undefined)
    parts.push(`mac = ${await toLua(override.mac)}`);
  return `command.update { ${parts.join(", ")} }`;
}

/**
 * Remove the source range [start, end) from text; when that leaves its line
 * blank, remove the whole line.
 */
function removeRange(text: string, start: number, end: number): string {
  let from = start;
  while (from > 0 && (text[from - 1] === " " || text[from - 1] === "\t")) {
    from--;
  }
  let to = end;
  while (to < text.length && (text[to] === " " || text[to] === "\t")) to++;
  const atLineStart = from === 0 || text[from - 1] === "\n";
  if (atLineStart && (to === text.length || text[to] === "\n")) {
    // The line held only this statement: drop it with one line break
    if (to < text.length) to++;
    else if (from > 0) from--;
    return text.slice(0, from) + text.slice(to);
  }
  return text.slice(0, start) + text.slice(to);
}

type Edit = ManagedStatement & { replacement: string | null };

/**
 * Apply changes to the managed block of a CONFIG text by editing statements
 * in place: a set replaces the first statement for its config path or
 * command (removing any duplicates) or is appended, an unset removes them
 * all. Every other line and block is left untouched. The block is created
 * when needed and removed once it holds nothing but the marker. Refuses
 * (throws) to edit a block that is not valid Lua.
 */
export async function applyManagedChanges(
  text: string,
  changes: ManagedChanges,
): Promise<string> {
  const sets = await Promise.all([
    ...Object.entries(changes.config?.set ?? {}).map(async ([key, value]) => ({
      kind: "config" as const,
      key,
      statement: await configStatement(key, value),
    })),
    ...Object.entries(changes.commands?.set ?? {}).map(
      async ([key, value]) => ({
        kind: "command" as const,
        key,
        statement: await commandStatement(key, value),
      }),
    ),
  ]);
  const unsets = [
    ...(changes.config?.unset ?? []).map((key) => ({ kind: "config", key })),
    ...(changes.commands?.unset ?? []).map((key) => ({ kind: "command", key })),
  ];

  const block = findManagedBlock(text);
  const inner = block ? block.innerContent.replace(/\n+$/, "") : MANAGED_MARKER;
  let statements: ManagedStatement[];
  try {
    statements = await scanManagedStatements(inner);
  } catch (e: any) {
    throw new Error(invalidManagedBlockMessage(e.message));
  }
  const statementsFor = (kind: string, key: string) =>
    statements.filter((st) => st.kind === kind && st.key === key);

  const edits: Edit[] = [];
  const appended: string[] = [];
  for (const { kind, key, statement } of sets) {
    const [first, ...duplicates] = statementsFor(kind, key);
    if (!first) {
      appended.push(statement);
      continue;
    }
    edits.push({ ...first, replacement: statement });
    for (const st of duplicates) edits.push({ ...st, replacement: null });
  }
  for (const { kind, key } of unsets) {
    for (const st of statementsFor(kind, key)) {
      edits.push({ ...st, replacement: null });
    }
  }

  // Back to front, so earlier ranges stay valid
  let updated = inner;
  for (const { start, end, replacement } of edits.sort(
    (a, b) => b.start - a.start,
  )) {
    updated =
      replacement === null
        ? removeRange(updated, start, end)
        : updated.slice(0, start) + replacement + updated.slice(end);
  }
  updated = [updated, ...appended].join("\n");

  if (updated.trim() === MANAGED_MARKER) return replaceManagedBlock(text, "");
  if (!block) return replaceManagedBlock(text, updated);
  // Splice only the block's own fence so trailing whitespace (which the fence
  // regex swallows) is preserved
  const trailing = text.slice(block.start, block.end).match(/\s*$/)![0];
  return (
    text.slice(0, block.start) +
    `\`\`\`space-lua\n${updated}\n\`\`\`` +
    trailing +
    text.slice(block.end)
  );
}

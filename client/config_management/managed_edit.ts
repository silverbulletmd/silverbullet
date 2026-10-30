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
} from "./managed_lua.ts";

/** What saving changes in one kind of override: values to write, keys to drop */
export type OverrideChanges<T> = {
  set: Record<string, T>;
  unset: string[];
};

/**
 * Changes to the managed block of CONFIG. Overrides not mentioned are left
 * untouched, so a value written elsewhere meanwhile (e.g. by Share) survives.
 */
export type ManagedChanges = {
  config?: OverrideChanges<unknown>;
  commands?: OverrideChanges<CommandOverride>;
};

/**
 * The changes that turn the initial overrides into the current ones: keys
 * that are new or have a different value are set, missing ones unset.
 * Undefined values (e.g. non-literal Lua) are never written.
 */
export function diffOverrides<T>(
  initial: Record<string, T>,
  current: Record<string, T>,
): OverrideChanges<T> {
  const set: Record<string, T> = {};
  for (const [key, value] of Object.entries(current)) {
    if (value === undefined) continue;
    if (
      !Object.hasOwn(initial, key) ||
      JSON.stringify(initial[key]) !== JSON.stringify(value)
    ) {
      set[key] = value;
    }
  }
  const unset = Object.keys(initial).filter(
    (key) => !Object.hasOwn(current, key),
  );
  return { set, unset };
}

function configStatement(path: string, value: unknown): string {
  return `config.set(${toLua(path)}, ${toLua(value)})`;
}

function commandStatement(name: string, override: CommandOverride): string {
  const parts = [`name = ${toLua(name)}`];
  if (override.key !== undefined) parts.push(`key = ${toLua(override.key)}`);
  if (override.mac !== undefined) parts.push(`mac = ${toLua(override.mac)}`);
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
export function applyManagedChanges(
  text: string,
  changes: ManagedChanges,
): string {
  const sets = [
    ...Object.entries(changes.config?.set ?? {}).map(([key, value]) => ({
      kind: "config" as const,
      key,
      statement: configStatement(key, value),
    })),
    ...Object.entries(changes.commands?.set ?? {}).map(([key, value]) => ({
      kind: "command" as const,
      key,
      statement: commandStatement(key, value),
    })),
  ];
  const unsets = [
    ...(changes.config?.unset ?? []).map((key) => ({ kind: "config", key })),
    ...(changes.commands?.unset ?? []).map((key) => ({ kind: "command", key })),
  ];

  const block = findManagedBlock(text);
  const inner = block ? block.innerContent.replace(/\n+$/, "") : MANAGED_MARKER;
  let statements: ManagedStatement[];
  try {
    statements = scanManagedStatements(inner);
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

  return replaceManagedBlock(
    text,
    updated.trim() === MANAGED_MARKER ? "" : updated,
  );
}

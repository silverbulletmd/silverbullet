import {
  CONFIG_BLOCK,
  findManagedBlock,
  invalidManagedBlockMessage,
  type ManagedBlockKind,
  replaceManagedBlock,
} from "./config_block.ts";
import {
  type CommandOverride,
  type LiteralExtension,
  type ScannedStatement,
  scanStatements,
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

type Edit = { start: number; end: number; replacement: string | null };

export type BlockWrite = {
  key: string;
  statement: string;
  /** A narrower edit of the statement it replaces, instead of the whole statement */
  replace?: (st: ScannedStatement, inner: string) => Edit | undefined;
};

export type BlockChanges = {
  /** Statements to write; the last write to a key wins */
  writes: BlockWrite[];
  /** Keys whose statements are removed, unless also written */
  removals: string[];
};

/**
 * Apply changes to a managed block of a CONFIG text by editing statements in
 * place: a write replaces the first statement with its key (removing any
 * duplicates) or is appended, a removal removes them all. Every other line
 * and block is left untouched. The block is created when needed and removed
 * once it holds nothing but its header. Refuses (throws) to edit a block that
 * is not valid Lua.
 */
export function editManagedBlock(
  text: string,
  kind: ManagedBlockKind,
  keyOf: (st: ScannedStatement) => string | null,
  { writes, removals }: BlockChanges,
  ext?: LiteralExtension,
): string {
  const block = findManagedBlock(text, kind);
  const inner = block ? block.innerContent.replace(/\n+$/, "") : kind.header;
  let statements: ScannedStatement[];
  try {
    statements = scanStatements(inner, ext);
  } catch (e: any) {
    throw new Error(invalidManagedBlockMessage(e.message, kind));
  }
  const unique = [...new Map(writes.map((w) => [w.key, w])).values()];
  const written = new Set(unique.map((w) => w.key));
  const removed = new Set(removals.filter((key) => !written.has(key)));

  const edits: Edit[] = [];
  const appended: string[] = [];
  for (const write of unique) {
    const [first, ...duplicates] = statements.filter(
      (st) => keyOf(st) === write.key,
    );
    if (!first) {
      appended.push(write.statement);
      continue;
    }
    edits.push(
      write.replace?.(first, inner) ?? {
        start: first.start,
        end: first.end,
        replacement: write.statement,
      },
    );
    for (const st of duplicates) edits.push({ ...st, replacement: null });
  }
  for (const st of statements) {
    const key = keyOf(st);
    if (key !== null && removed.has(key)) {
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
  updated = [updated.replace(/\n+$/, ""), ...appended].join("\n");

  const header = new Set(kind.header.split("\n"));
  const onlyHeader = updated
    .split("\n")
    .every((line) => !line.trim() || header.has(line.trim()));
  return replaceManagedBlock(text, onlyHeader ? "" : updated, kind);
}

const configKey = (path: string) => `config:${path}`;
const commandKey = (name: string) => `command:${name}`;

function managedKey(st: ScannedStatement): string | null {
  if (st.kind === "set" && typeof st.path === "string") {
    return configKey(st.path);
  }
  return st.kind === "command" ? commandKey(st.name) : null;
}

function commandStatement(name: string, override: CommandOverride): string {
  const parts = [`name = ${toLua(name)}`];
  if (override.key !== undefined) parts.push(`key = ${toLua(override.key)}`);
  if (override.mac !== undefined) parts.push(`mac = ${toLua(override.mac)}`);
  return `command.update { ${parts.join(", ")} }`;
}

/**
 * Apply changes to the managed configuration block of a CONFIG text (see
 * editManagedBlock): a set replaces the statement for its config path or
 * command, an unset removes them all.
 */
export function applyManagedChanges(
  text: string,
  changes: ManagedChanges,
): string {
  return editManagedBlock(text, CONFIG_BLOCK, managedKey, {
    writes: [
      ...Object.entries(changes.config?.set ?? {}).map(([path, value]) => ({
        key: configKey(path),
        statement: `config.set(${toLua(path)}, ${toLua(value)})`,
      })),
      ...Object.entries(changes.commands?.set ?? {}).map(
        ([name, override]) => ({
          key: commandKey(name),
          statement: commandStatement(name, override),
        }),
      ),
    ],
    removals: [
      ...(changes.config?.unset ?? []).map(configKey),
      ...(changes.commands?.unset ?? []).map(commandKey),
    ],
  });
}

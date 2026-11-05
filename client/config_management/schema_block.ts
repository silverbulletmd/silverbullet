/**
 * The managed schemas block of CONFIG: tag schemas the Workbench's Data tab
 * owns (`tag.define`) and its targeted changes to schemas defined elsewhere
 * (`config.set`, `tag.setRequired`).
 */
import { findManagedBlock, SCHEMAS_BLOCK } from "./config_block.ts";
import { editManagedBlock } from "./managed_edit.ts";
import {
  type ScannedStatement,
  scanStatements,
  UNREADABLE,
} from "./managed_lua.ts";
import {
  defineStatement,
  type JsonSchema,
  requireStatement,
  SCHEMA_LITERALS,
  schemaToLua,
  setStatement,
} from "./schema_lua.ts";

export type SchemaSet = { path: string[]; value: unknown };
export type SchemaRequire = {
  tag: string;
  attribute: string;
  required: boolean;
};

export type SchemaChanges = {
  /** Whole-schema definitions owned by the block, by tag */
  define: Record<string, JsonSchema>;
  /** Targeted writes; a value of CONFIG_UNSET suppresses */
  set: SchemaSet[];
  /** Paths whose targeted write is removed, revealing the underlying definition */
  reset: string[][];
  require: SchemaRequire[];
  /** Requirements whose statement is removed */
  resetRequire?: { tag: string; attribute: string }[];
};

export type OwnedSchemas = {
  defines: Record<string, JsonSchema>;
  sets: SchemaSet[];
  requires: SchemaRequire[];
  error?: string;
};

const defineKey = (tag: string) => `define:${tag}`;
const setKey = (path: string[]) => `set:${JSON.stringify(path)}`;
const requireKey = (tag: string, attribute: string) =>
  `require:${JSON.stringify([tag, attribute])}`;

const pathOf = (path: string | string[]) =>
  typeof path === "string" ? path.split(".") : path;

function keyOf(st: ScannedStatement): string | null {
  switch (st.kind) {
    case "define":
      // A definition without a schema (tagPage only, say) isn't the one a schema replaces
      return st.schema ? defineKey(st.tag) : null;
    case "set":
      return st.value === UNREADABLE ? null : setKey(pathOf(st.path));
    case "require":
      return requireKey(st.tag, st.attribute);
    default:
      return null;
  }
}

export function readSchemaBlock(configText: string): OwnedSchemas {
  const owned: OwnedSchemas = { defines: {}, sets: [], requires: [] };
  const block = findManagedBlock(configText, SCHEMAS_BLOCK);
  if (!block) return owned;
  let statements: ScannedStatement[];
  try {
    statements = scanStatements(block.innerContent, SCHEMA_LITERALS);
  } catch (e: any) {
    return { ...owned, error: e?.message ?? String(e) };
  }
  for (const st of statements) {
    if (st.kind === "define" && st.schema) owned.defines[st.tag] = st.schema;
    else if (st.kind === "set" && st.value !== UNREADABLE) {
      owned.sets.push({ path: pathOf(st.path), value: st.value });
    } else if (st.kind === "require") {
      const { tag, attribute, required } = st;
      owned.requires.push({ tag, attribute, required });
    }
  }
  return owned;
}

/**
 * Applies changes to the schemas block of CONFIG, statement by statement
 * (see editManagedBlock): a change replaces the statement for its tag, path
 * or requirement; resets remove them. A define that has other fields or
 * comments keeps them: only its schema is replaced.
 */
export function applySchemaChanges(
  configText: string,
  changes: SchemaChanges,
): string {
  return editManagedBlock(
    configText,
    SCHEMAS_BLOCK,
    keyOf,
    {
      writes: [
        ...Object.entries(changes.define).map(([tag, schema]) => ({
          key: defineKey(tag),
          statement: defineStatement(tag, schema),
          replace: (st: ScannedStatement, inner: string) =>
            st.kind === "define" &&
            st.schemaRange &&
            (st.other.length > 0 ||
              inner.slice(st.start, st.end).includes("--"))
              ? { ...st.schemaRange, replacement: schemaToLua(schema) }
              : undefined,
        })),
        ...changes.set.map(({ path, value }) => ({
          key: setKey(path),
          statement: setStatement(path, value),
        })),
        ...changes.require.map(({ tag, attribute, required }) => ({
          key: requireKey(tag, attribute),
          statement: requireStatement(tag, attribute, required),
        })),
      ],
      removals: [
        ...changes.reset.map(setKey),
        ...(changes.resetRequire ?? []).map(({ tag, attribute }) =>
          requireKey(tag, attribute),
        ),
      ],
    },
    SCHEMA_LITERALS,
  );
}

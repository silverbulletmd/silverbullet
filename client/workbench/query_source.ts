/**
 * What the query builder reads from the running client: tags, sampled
 * objects, declared schemas, aggregates, and the result of a query.
 */
import type { Client } from "../client.ts";
import { tagSchema } from "../plugos/syscalls/schema_introspection.ts";
import { getBuiltinAggregateEntries } from "../space_lua/aggregates.ts";
import { BUSY_LIMIT_DEFAULT_MS, makeLuaBudget } from "../space_lua/budget.ts";
import { evalExpression } from "../space_lua/eval.ts";
import { parseExpressionString } from "../space_lua/parse.ts";
import { LuaEnv, LuaStackFrame } from "../space_lua/runtime.ts";
import { stdLibPrefix } from "../spaces/constants.ts";
import {
  declaredFieldsFromSchema,
  type FieldInfo,
  inferFields,
} from "./query_fields.ts";

/** The object types the indexer produces itself (see `docs/Object/`) */
export const BUILTIN_OBJECT_TAGS: readonly string[] = [
  "page",
  "task",
  "item",
  "paragraph",
  "header",
  "link",
  "tag",
  "anchor",
  "table",
  "data",
  "document",
  "relation",
  "aspiring-page",
  "ambiguous-link",
  "space-lua",
];

export const SAMPLE_LIMIT = 500;

export function splitTags(names: string[]): {
  custom: string[];
  builtIn: string[];
} {
  const seen = new Set(names);
  return {
    custom: [...seen]
      .filter((n) => !BUILTIN_OBJECT_TAGS.includes(n))
      .sort((a, b) => a.localeCompare(b)),
    builtIn: BUILTIN_OBJECT_TAGS.filter((n) => seen.has(n)),
  };
}

/** The tags whose name contains `phrase` (ignoring case and a leading `#`), best matches first */
export function filterTags(
  tags: { custom: string[]; builtIn: string[] },
  phrase: string,
): { custom: string[]; builtIn: string[] } {
  const p = phrase.trim().replace(/^#/, "").toLowerCase();
  if (!p) return tags;
  const pick = (names: string[]) =>
    names
      .filter((n) => n.toLowerCase().includes(p))
      .map((n, i) => [n, i] as const)
      .sort(
        ([a, i], [b, j]) =>
          Number(!a.toLowerCase().startsWith(p)) -
            Number(!b.toLowerCase().startsWith(p)) || i - j,
      )
      .map(([n]) => n);
  return { custom: pick(tags.custom), builtIn: pick(tags.builtIn) };
}

/** The tag the Query tab opens on */
export const START_TAG = "page";

/**
 * Hashtags in use outside the standard library (as on the Scripts tab), plus
 * every built-in object type
 */
export async function listTags(
  client: Client,
): Promise<{ custom: string[]; builtIn: string[] }> {
  const tags = await client.queryLuaObjects<{ name: string; page?: string }>(
    "tag",
    {},
  );
  const used = tags
    .filter((t) => !t.page?.startsWith(stdLibPrefix))
    .map((t) => t.name);
  return splitTags([...used, ...BUILTIN_OBJECT_TAGS]);
}

export async function loadFields(
  client: Client,
  tag: string,
): Promise<{ fields: FieldInfo[]; sampled: number }> {
  const samples = await client.queryLuaObjects<Record<string, unknown>>(tag, {
    objectVariable: "o",
    limit: SAMPLE_LIMIT,
  });
  const tags = client.config.get(["tags"], {});
  const declared = declaredFieldsFromSchema(tagSchema(tags, tag));
  if (!samples.length && !declared) return { fields: [], sampled: 0 };
  // A custom tag on pages (or tasks, items…): the objects also carry that
  // type's own fields, which say little about the tag
  const base = samples[0]?.tag;
  if (typeof base !== "string" || base === tag) {
    return {
      fields: inferFields(samples, declared, BUILTIN_OBJECT_TAGS.includes(tag)),
      sampled: samples.length,
    };
  }
  const baseFields = declaredFieldsFromSchema(tagSchema(tags, base)) ?? {};
  const fields = inferFields(samples, { ...baseFields, ...declared }, false)
    .map((f) =>
      f.name in baseFields && !declared?.[f.name]
        ? { ...f, source: "built-in" as const }
        : f,
    )
    // The base type's fields that none of these objects use are only noise
    .filter((f) => f.source !== "built-in" || f.present > 0);
  const rank = (f: FieldInfo) =>
    f.name === "name" ? 0 : f.source === "built-in" ? 2 : 1;
  return {
    fields: fields
      .map((f, i) => [f, i] as const)
      .sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j)
      .map(([f]) => f),
    sampled: samples.length,
  };
}

export function aggregateChoices(
  client: Client,
): { name: string; description: string }[] {
  const custom = client.config.get<Record<string, { description?: string }>>(
    "aggregates",
    {},
  );
  return [
    ...getBuiltinAggregateEntries().map(({ name, description }) => ({
      name,
      description,
    })),
    ...Object.entries(custom).map(([name, spec]) => ({
      name,
      description: spec?.description ?? "",
    })),
  ];
}

/**
 * Evaluates an unwrapped `query[[…]]` in the space's global env. Unlike a
 * page's `${…}`, it has no current page and no prompt to stop a slow query;
 * the busy limit still applies.
 */
export async function evalQueryText(
  client: Client,
  text: string,
): Promise<unknown> {
  const expr = parseExpressionString(text);
  const tl = new LuaEnv();
  tl.setLocal("_GLOBAL", client.clientSystem.spaceLuaEnv.env);
  const budget = makeLuaBudget({ busyLimitMs: BUSY_LIMIT_DEFAULT_MS });
  const sf = new LuaStackFrame(tl, expr.ctx, undefined, undefined, {
    closeStack: undefined,
    budget,
  });
  try {
    return await evalExpression(expr, client.clientSystem.spaceLuaEnv.env, sf);
  } finally {
    budget.finished = true;
  }
}

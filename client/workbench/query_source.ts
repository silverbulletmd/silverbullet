/**
 * What the query builder reads from the running client: tags, sampled
 * objects, declared schemas, aggregates, and the result of a query.
 */
import {
  builtinTagsOfKind,
  isBuiltinTag,
  type TagKind,
} from "@silverbulletmd/silverbullet/lib/tags";
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

/** The order the Query tab lists built-in tags in, one group per kind */
export const TAG_KIND_GROUPS: readonly { kind: TagKind; label: string }[] = [
  { kind: "root", label: "Root" },
  { kind: "edge", label: "Edges" },
  { kind: "index", label: "Index" },
  { kind: "system", label: "System" },
];

/** Every built-in tag the Query tab offers, in group order (the deprecated `link` view is left out) */
export const BUILTIN_QUERY_TAGS: readonly string[] = TAG_KIND_GROUPS.flatMap(
  (g) => builtinTagsOfKind(g.kind),
);

export const SAMPLE_LIMIT = 500;

export type TagLists = { user: string[]; builtIn: string[] };

export function splitTags(names: string[]): TagLists {
  const seen = new Set(names);
  return {
    user: [...seen]
      .filter((n) => !isBuiltinTag(n))
      .sort((a, b) => a.localeCompare(b)),
    builtIn: BUILTIN_QUERY_TAGS.filter((n) => seen.has(n)),
  };
}

/** The tags whose name contains `phrase` (ignoring case and a leading `#`), best matches first */
export function filterTags(tags: TagLists, phrase: string): TagLists {
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
  return { user: pick(tags.user), builtIn: pick(tags.builtIn) };
}

/** The tag the Query tab opens on */
export const START_TAG = "page";

/**
 * User tags in use outside the standard library (as on the Scripts tab), plus
 * every built-in tag
 */
export async function listTags(client: Client): Promise<TagLists> {
  const tags = await client.queryLuaObjects<{ name: string; page?: string }>(
    "tag",
    {},
  );
  const used = tags
    .filter((t) => !t.page?.startsWith(stdLibPrefix))
    .map((t) => t.name);
  return splitTags([...used, ...BUILTIN_QUERY_TAGS]);
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
  // A user tag on pages (or tasks, items…): the objects also carry their
  // root tag's own fields, which say little about the user tag
  const base = samples[0]?.tag;
  if (typeof base !== "string" || base === tag) {
    return {
      fields: inferFields(samples, declared, isBuiltinTag(tag)),
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

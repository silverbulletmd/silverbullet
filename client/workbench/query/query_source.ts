import { renderThread, toRenderValue } from "../../space_lua/render_thread.ts";
/**
 * What the query builder reads from the running client: sampled objects,
 * declared schemas, aggregates, and the result of a query; and picking a
 * source into the builder with the attributes it reads.
 */
import { isBuiltinTag } from "@silverbulletmd/silverbullet/lib/tags";
import type { Client } from "../../client.ts";
import { tagSchema } from "../../plugos/syscalls/schema_introspection.ts";
import { getBuiltinAggregateEntries } from "../../space_lua/aggregates.ts";
import {
  BUSY_LIMIT_DEFAULT_MS,
  makeLuaBudget,
} from "../../space_lua/budget.ts";
import { evalExpression } from "../../space_lua/eval.ts";
import { parseExpressionString } from "../../space_lua/parse.ts";
import { LuaEnv, LuaStackFrame } from "../../space_lua/runtime.ts";
import {
  type AttributeInfo,
  declaredAttributesFromSchema,
  inferAttributes,
} from "./query_attributes.ts";
import type { QueryBuilder } from "./query_builder.ts";
import {
  listedSource,
  type QuerySource,
  sameSource,
  sampleQuery,
  schemaTag,
  sourceLabel,
} from "./query_from.ts";

export const SAMPLE_LIMIT = 500;

/** The tag the Query tab opens on */
export const START_SOURCE: QuerySource = listedSource("page");

/** The relation kinds in use (mention, spouse, …) */
export async function listRelationKinds(client: Client): Promise<string[]> {
  const kinds = await client.queryLuaObjects<string>("relation", {
    objectVariable: "r",
    select: parseExpressionString("r.kind"),
    distinct: true,
  });
  return kinds
    .filter((k) => typeof k === "string")
    .sort((a, b) => a.localeCompare(b));
}

export async function loadAttributes(
  client: Client,
  source: QuerySource,
): Promise<{
  attributes: AttributeInfo[];
  sampled: number;
  /** The sampled objects themselves */
  samples: Record<string, unknown>[];
  /** For a user tag, the root tag its sampled objects are */
  root: string | null;
}> {
  const { key, where } = sampleQuery(source);
  const samples = await client.queryLuaObjects<Record<string, unknown>>(key, {
    objectVariable: "o",
    ...(where ? { where: parseExpressionString(where) } : {}),
    limit: SAMPLE_LIMIT,
  });
  const tag = schemaTag(source);
  const tags = client.config.get(["tags"], {});
  const declared = declaredAttributesFromSchema(tagSchema(tags, tag));
  if (!samples.length && !declared) {
    return { attributes: [], sampled: 0, samples, root: null };
  }
  // A user tag on pages (or tasks, items…): the objects also carry their
  // root tag's own attributes, which say little about the user tag
  const base = samples[0]?.tag;
  if (typeof base !== "string" || base === tag) {
    return {
      attributes: inferAttributes(samples, declared, isBuiltinTag(tag)),
      sampled: samples.length,
      samples,
      root: null,
    };
  }
  const baseAttributes =
    declaredAttributesFromSchema(tagSchema(tags, base)) ?? {};
  const attributes = inferAttributes(
    samples,
    { ...baseAttributes, ...declared },
    false,
  )
    .map((f) =>
      f.name in baseAttributes && !declared?.[f.name]
        ? { ...f, source: "built-in" as const }
        : f,
    )
    // The base type's attributes that none of these objects use are only noise
    .filter((f) => f.source !== "built-in" || f.present > 0);
  const rank = (f: AttributeInfo) =>
    f.name === "name" ? 0 : f.source === "built-in" ? 2 : 1;
  return {
    attributes: attributes
      .map((f, i) => [f, i] as const)
      .sort(([a, i], [b, j]) => rank(a) - rank(b) || i - j)
      .map(([f]) => f),
    sampled: samples.length,
    samples,
    root: base,
  };
}

/** Starts the builder over on `source`, offering Undo when that drops an edited query */
export async function pickSource(
  client: Client,
  builder: QueryBuilder,
  source: QuerySource,
): Promise<void> {
  const old = builder.model?.source;
  if (old && sameSource(source, old)) return;
  const { attributes } = await loadAttributes(client, source);
  if (builder.pickSource(source, attributes) && old) {
    client.ui.flashNotification(
      `Cleared the query for ${sourceLabel(old)}`,
      "info",
      { actions: [{ name: "Undo", run: () => void builder.undo() }] },
    );
  }
}

/** Narrows the picked root tag to a user tag (or kind), or a user tag to a root tag */
export async function narrowSource(
  client: Client,
  builder: QueryBuilder,
  source: QuerySource,
): Promise<void> {
  const { attributes } = await loadAttributes(client, source);
  builder.narrow(source, attributes);
}

/** Loads the current source's attributes again, the space's scripts or index having changed */
export async function refreshSource(
  client: Client,
  builder: QueryBuilder,
): Promise<void> {
  const source = builder.model?.source;
  if (!source) return;
  const { attributes } = await loadAttributes(client, source);
  // Another tag picked meanwhile brought its own attributes
  if (builder.model?.source !== source) return;
  builder.refreshData(attributes);
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
  if (client.bootConfig?.canBuild === false) {
    const { env, sf } = renderThread(
      client.clientSystem.spaceLuaEnv.env,
      expr.ctx,
    );
    return toRenderValue(await evalExpression(expr, env, sf), sf);
  }
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

import { index, lua, markdown } from "@silverbulletmd/silverbullet/syscalls";
import {
  extractFrontMatter as extractFrontmatterFromTree,
  type FrontMatter,
  type FrontMatterExtractOptions,
  patchFrontmatterText,
} from "./frontmatter.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import { applyPatches, type YamlPatch } from "../../plug-api/lib/yaml.ts";
import type { LuaCollectionQuery } from "../../client/space_lua/query_collection.ts";
import type { ObjectValue } from "@silverbulletmd/silverbullet/type/index";
import type { ResolveAnchorResult } from "./types.ts";
export type { AnchorHit, ResolveAnchorResult } from "./types.ts";

/*
 * Key namespace:
 * [indexKey, type, ...key, page] -> value
 * [pageKey, page, ...key] -> true // for fast page clearing
 * ["type", type] -> true // for fast type listing
 */

export async function extractFrontmatter(
  text: string,
  extractOptions: FrontMatterExtractOptions = {},
): Promise<{ frontmatter: FrontMatter; text: string }> {
  const tree = await markdown.parseMarkdown(text);
  const frontmatter = extractFrontmatterFromTree(tree, extractOptions);
  return { frontmatter, text: renderToText(tree) };
}

export async function patchFrontmatter(
  text: string,
  patches: YamlPatch[],
): Promise<string> {
  const tree = await markdown.parseMarkdown(text);
  return patchFrontmatterText(text, tree, (yaml) =>
    applyPatches(yaml, patches),
  );
}

export async function resolveAnchor(
  name: string,
  page?: string,
): Promise<ResolveAnchorResult> {
  const candidates = await index.queryLuaObjects<{
    ref: string;
    page: string;
    hostTag: string;
  }>(
    "anchor",
    {
      objectVariable: "_",
      where: page
        ? await lua.parseExpression(`_.ref == name and _.page == p`)
        : await lua.parseExpression(`_.ref == name`),
    },
    page ? { name, p: page } : { name },
  );

  if (candidates.length === 0) {
    return { ok: false, reason: "missing" };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: "duplicate",
      hits: candidates.map((c) => ({ page: c.page, hostTag: c.hostTag })),
    };
  }
  const hit = candidates[0];
  // Page-level anchors don't have a host with a `range`; the anchor
  // points at the whole page. Resolve to position 0.
  if (hit.hostTag === "page") {
    return {
      ok: true,
      page: hit.page,
      hostTag: "page",
      range: [0, 0],
    };
  }
  const host = await index.getObjectByRef<{ range: [number, number] }>(
    hit.page,
    hit.hostTag,
    name,
  );
  if (!host) {
    return { ok: false, reason: "missing" };
  }
  return {
    ok: true,
    page: hit.page,
    hostTag: hit.hostTag,
    range: host.range,
  };
}

// DEPRECATED: use index.queryLuaObjects directly
export function queryLuaObjects<T>(
  tag: string,
  query: LuaCollectionQuery,
  scopedVariables?: Record<string, any>,
): Promise<ObjectValue<T>[]> {
  return index.queryLuaObjects(tag, query, scopedVariables);
}

// DEPRECATED: use index.getObjectByRef directly
export function getObjectByRef<T>(
  page: string,
  tag: string,
  ref: string,
): Promise<ObjectValue<T> | undefined> {
  return index.getObjectByRef(page, tag, ref);
}

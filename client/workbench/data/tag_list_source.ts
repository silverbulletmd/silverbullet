import { isMetaTag } from "@silverbulletmd/silverbullet/lib/tags";
import type { Client } from "../../client.ts";
import { stdLibPrefix } from "../../spaces/constants.ts";
import { pinnedTags } from "./pins.ts";
import { buildTagList, type TagListSections } from "./tag_list.ts";

/**
 * The Data tab's tag list: tags used outside the standard library (as on
 * the Query tab), `meta/*` tags wherever they're used, every defined tag
 * including library ones, and their counts.
 */
export async function loadTagSections(
  client: Client,
): Promise<TagListSections | null> {
  // Before the index and scripts are in, the list would look empty rather than loading
  if (!client.fullIndexCompleted || !client.clientSystem.scriptsLoaded) {
    return null;
  }
  const records = await client.queryLuaObjects<{
    name: string;
    page?: string;
    parent?: string;
  }>("tag", {});
  const definitions = client.config.get<Record<string, any>>(["tags"], {});
  // Std's meta tags (meta/library, meta/theme, meta/template/...) are the
  // space's own building blocks, so they stay listed
  const used = records.filter(
    (t) => isMetaTag(t.name) || !t.page?.startsWith(stdLibPrefix),
  );
  const names = new Set([
    ...used.map((r) => r.name),
    ...Object.keys(definitions),
  ]);
  const counts: Record<string, number> = {};
  await Promise.all(
    [...names].map(async (name) => {
      counts[name] = await client.objectIndex.countTag(name);
    }),
  );
  return buildTagList({
    records: used,
    definitions,
    counts,
    pinned: pinnedTags(client.config),
  });
}

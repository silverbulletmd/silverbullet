import { fulltext } from "$sb/plugos-syscall/mod.ts";
import { renderToText } from "$sb/lib/tree.ts";
import type { PageMeta } from "../../common/types.ts";
import { editor, index } from "$sb/silverbullet-syscall/mod.ts";
import { IndexTreeEvent, QueryProviderEvent } from "$sb/app_event.ts";
import { applyQuery, removeQueries } from "$sb/lib/query.ts";

const searchPrefix = "🔍 ";

export async function pageIndex(data: IndexTreeEvent) {
  removeQueries(data.tree);
  const cleanText = renderToText(data.tree);
  await fulltext.fullTextIndex(data.name, cleanText);
}

export async function pageUnindex(pageName: string) {
  await fulltext.fullTextDelete(pageName);
}

export async function queryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  const phraseFilter = query.filter.find((f) => f.prop === "phrase");
  if (!phraseFilter) {
    throw Error("No 'phrase' filter specified, this is mandatory");
  }
  let results = await fulltext.fullTextSearch(phraseFilter.value, 100);

  const allPageMap: Map<string, any> = new Map(
    results.map((r: any) => [r.name, r]),
  );
  for (const { page, value } of await index.queryPrefix("meta:")) {
    const p = allPageMap.get(page);
    if (p) {
      for (const [k, v] of Object.entries(value)) {
        p[k] = v;
      }
    }
  }

  // Remove the "phrase" filter
  query.filter.splice(query.filter.indexOf(phraseFilter), 1);

  results = applyQuery(query, results);
  return results;
}

export async function searchCommand() {
  const phrase = await prompt("Search for: ");
  if (phrase) {
    await editor.navigate(`${searchPrefix}${phrase}`);
  }
}

export async function readPageSearch(
  name: string,
): Promise<{ text: string; meta: PageMeta }> {
  const phrase = name.substring(searchPrefix.length);
  const results = await fulltext.fullTextSearch(phrase, 100);
  const text = `# Search results for "${phrase}"\n${
    results
      .map((r: any) => `* [[${r.name}]] (score: ${r.rank})`)
      .join("\n")
  }
  `;
  return {
    text: text,
    meta: {
      name,
      lastModified: 0,
      perm: "ro",
    },
  };
}

export function getPageMetaSearch(name: string): PageMeta {
  return {
    name,
    lastModified: 0,
    perm: "ro",
  };
}

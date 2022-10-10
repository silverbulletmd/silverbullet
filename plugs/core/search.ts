import {
  fullTextDelete,
  fullTextIndex,
  fullTextSearch,
} from "../../syscall/plugos-syscall/fulltext.ts";
import { renderToText } from "../../common/tree.ts";
import { PageMeta } from "../../common/types.ts";
import { queryPrefix } from "../../syscall/silverbullet-syscall/index.ts";
import { navigate, prompt } from "../../syscall/silverbullet-syscall/editor.ts";
import { IndexTreeEvent } from "../../web/app_event.ts";
import { applyQuery, QueryProviderEvent } from "../query/engine.ts";
import { removeQueries } from "../query/util.ts";

const searchPrefix = "🔍 ";

export async function index(data: IndexTreeEvent) {
  removeQueries(data.tree);
  let cleanText = renderToText(data.tree);
  await fullTextIndex(data.name, cleanText);
}

export async function unindex(pageName: string) {
  await fullTextDelete(pageName);
}

export async function queryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  let phraseFilter = query.filter.find((f) => f.prop === "phrase");
  if (!phraseFilter) {
    throw Error("No 'phrase' filter specified, this is mandatory");
  }
  let results = await fullTextSearch(phraseFilter.value, 100);

  let allPageMap: Map<string, any> = new Map(
    results.map((r: any) => [r.name, r])
  );
  for (let { page, value } of await queryPrefix("meta:")) {
    let p = allPageMap.get(page);
    if (p) {
      for (let [k, v] of Object.entries(value)) {
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
  let phrase = await prompt("Search for: ");
  if (phrase) {
    await navigate(`${searchPrefix}${phrase}`);
  }
}

export async function readPageSearch(
  name: string
): Promise<{ text: string; meta: PageMeta }> {
  let phrase = name.substring(searchPrefix.length);
  let results = await fullTextSearch(phrase, 100);
  const text = `# Search results for "${phrase}"\n${results
    .map((r: any) => `* [[${r.name}]] (score: ${r.rank})`)
    .join("\n")}
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

export async function getPageMetaSearch(name: string): Promise<PageMeta> {
  return {
    name,
    lastModified: 0,
    perm: "ro",
  };
}

import { fullTextIndex, fullTextSearch } from "@plugos/plugos-syscall/fulltext";
import { renderToText } from "@silverbulletmd/common/tree";
import { scanPrefixGlobal } from "@silverbulletmd/plugos-silverbullet-syscall";
import { IndexTreeEvent } from "@silverbulletmd/web/app_event";
import { applyQuery, QueryProviderEvent } from "../query/engine";
import { removeQueries } from "../query/util";

export async function index(data: IndexTreeEvent) {
  removeQueries(data.tree);
  let cleanText = renderToText(data.tree);
  await fullTextIndex(data.name, cleanText);
}

export async function queryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  let phraseFilter = query.filter.find((f) => f.prop === "phrase");
  if (!phraseFilter) {
    throw Error("No 'phrase' filter specified, this is mandatory");
  }
  let results = await fullTextSearch(phraseFilter.value, 100);

  let allPageMap: Map<string, any> = new Map(results.map((r) => [r.name, r]));
  for (let { page, value } of await scanPrefixGlobal("meta:")) {
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

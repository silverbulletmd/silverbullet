import { IndexTreeEvent, QueryProviderEvent } from "$sb/app_event.ts";
import { renderToText } from "$sb/lib/tree.ts";
import { store } from "$sb/plugos-syscall/mod.ts";
import { applyQuery } from "$sb/lib/query.ts";
import { editor, index } from "$sb/silverbullet-syscall/mod.ts";
import { base64EncodedDataUrl } from "../../plugos/asset_bundle/base64.ts";
import { BatchKVStore, SimpleSearchEngine } from "./engine.ts";
import { FileMeta } from "../../common/types.ts";

const searchPrefix = "🔍 ";

class StoreKVStore implements BatchKVStore<string, string[]> {
  constructor(private prefix: string) {
  }
  get(keys: string[]): Promise<(string[] | undefined)[]> {
    return store.batchGet(keys.map((key) => this.prefix + key));
  }
  set(entries: Map<string, string[]>): Promise<void> {
    return store.batchSet(
      Array.from(entries.entries()).map((
        [key, value],
      ) => ({ key: this.prefix + key, value })),
    );
  }
  delete(keys: string[]): Promise<void> {
    return store.batchDel(keys.map((key) => this.prefix + key));
  }
}

const engine = new SimpleSearchEngine(
  new StoreKVStore("fts:"),
  new StoreKVStore("fts_rev:"),
);

export async function indexPage({ name, tree }: IndexTreeEvent) {
  const text = renderToText(tree);
  //   console.log("Now FTS indexing", name);
  await engine.deleteDocument(name);
  await engine.indexDocument({ id: name, text });
}

export async function clearIndex() {
  await store.deletePrefix("fts:");
  await store.deletePrefix("fts_rev:");
}

export async function pageUnindex(pageName: string) {
  await engine.deleteDocument(pageName);
}

export async function queryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  const phraseFilter = query.filter.find((f) => f.prop === "phrase");
  if (!phraseFilter) {
    throw Error("No 'phrase' filter specified, this is mandatory");
  }
  let results: any[] = await engine.search(phraseFilter.value);

  // Patch the object to a format that users expect (translate id to name)
  for (const r of results) {
    r.name = r.id;
    delete r.id;
  }

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
  const phrase = await editor.prompt("Search for: ");
  if (phrase) {
    await editor.navigate(`${searchPrefix}${phrase}`);
  }
}

export async function readFileSearch(
  name: string,
): Promise<{ data: string; meta: FileMeta }> {
  const phrase = name.substring(
    searchPrefix.length,
    name.length - ".md".length,
  );
  const results = await engine.search(phrase);
  const text = `# Search results for "${phrase}"\n${
    results
      .map((r) => `* [[${r.id}]] (score ${r.score})`)
      .join("\n")
  }
    `;

  return {
    // encoding === "arraybuffer" is not an option, so either it's "utf8" or "dataurl"
    data: base64EncodedDataUrl(
      "text/markdown",
      new TextEncoder().encode(text),
    ),
    meta: {
      name,
      contentType: "text/markdown",
      size: text.length,
      lastModified: 0,
      perm: "ro",
    },
  };
}

export function writeFileSearch(
  name: string,
): FileMeta {
  // Never actually writing this
  return getFileMetaSearch(name);
}

export function getFileMetaSearch(name: string): FileMeta {
  return {
    name,
    contentType: "text/markdown",
    size: -1,
    lastModified: 0,
    perm: "ro",
  };
}

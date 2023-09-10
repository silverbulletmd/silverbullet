import { IndexTreeEvent, QueryProviderEvent } from "$sb/app_event.ts";
import { renderToText } from "$sb/lib/tree.ts";
import {
  applyQuery,
  evalQueryExpression,
  liftAttributeFilter,
} from "$sb/lib/query.ts";
import { editor, index, store } from "$sb/syscalls.ts";
import { BatchKVStore, SimpleSearchEngine } from "./engine.ts";
import { FileMeta } from "$sb/types.ts";
import { PromiseQueue } from "$sb/lib/async.ts";

const searchPrefix = "🔍 ";

class StoreKVStore implements BatchKVStore {
  constructor(private prefix: string) {
  }
  async queryPrefix(prefix: string): Promise<[string, any][]> {
    const results = await store.queryPrefix(this.prefix + prefix);
    return results.map((
      { key, value },
    ) => [key.substring(this.prefix.length), value]);
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

const ftsKvStore = new StoreKVStore("fts:");
const ftsRevKvStore = new StoreKVStore("fts_rev:");

const engine = new SimpleSearchEngine(ftsKvStore, ftsRevKvStore);

// Search indexing is prone to concurrency issues, so we queue all write operations
const promiseQueue = new PromiseQueue();

export function indexPage({ name, tree }: IndexTreeEvent) {
  const text = renderToText(tree);
  return promiseQueue.runInQueue(async () => {
    // console.log("Now FTS indexing", name);
    await engine.deleteDocument(name);
    await engine.indexDocument({ id: name, text });
  });
}

export async function clearIndex() {
  await store.deletePrefix("fts:");
  await store.deletePrefix("fts_rev:");
}

export function pageUnindex(pageName: string) {
  return promiseQueue.runInQueue(() => {
    return engine.deleteDocument(pageName);
  });
}

export async function queryProvider({
  query,
}: QueryProviderEvent): Promise<any[]> {
  const phraseFilter = liftAttributeFilter(query.filter, "phrase");
  if (!phraseFilter) {
    throw Error("No 'phrase' filter specified, this is mandatory");
  }
  const phrase = evalQueryExpression(phraseFilter, {});
  // console.log("Phrase", phrase);
  let results: any[] = await engine.search(phrase);

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
): Promise<{ data: Uint8Array; meta: FileMeta }> {
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
    data: new TextEncoder().encode(text),
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

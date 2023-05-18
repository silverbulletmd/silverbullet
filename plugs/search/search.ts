import { IndexTreeEvent } from "$sb/app_event.ts";
import { renderToText } from "$sb/lib/tree.ts";
import { store } from "$sb/plugos-syscall/mod.ts";
import { BatchKVStore, SimpleSearchEngine } from "./engine.ts";

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

export async function testCommand() {
  const results = await engine.search("zef hemel");
  for (const result of results) {
    console.log(result);
  }
}

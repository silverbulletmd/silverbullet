import { assertEquals } from "../../test_deps.ts";
import { BatchKVStore, SimpleSearchEngine } from "./engine.ts";

class InMemoryBatchKVStore<K, V> implements BatchKVStore<K, V> {
  private store = new Map<K, V>();

  get(keys: K[]): Promise<(V | undefined)[]> {
    const results: (V | undefined)[] = keys.map((key) => this.store.get(key));
    return Promise.resolve(results);
  }

  set(entries: Map<K, V>): Promise<void> {
    for (const [key, value] of entries) {
      this.store.set(key, value);
    }
    return Promise.resolve();
  }

  delete(keys: K[]): Promise<void> {
    for (const key of keys) {
      this.store.delete(key);
    }
    return Promise.resolve();
  }
}

Deno.test("Test full text search", async () => {
  const engine = new SimpleSearchEngine(
    new InMemoryBatchKVStore(),
    new InMemoryBatchKVStore(),
  );

  await engine.indexDocument({ id: "1", text: "The quick brown fox" });
  await engine.indexDocument({ id: "2", text: "jumps over the lazy dogs" });
  await engine.indexDocument({
    id: "3",
    text: "Hello world, jumping jump jumps",
  });
  await engine.indexDocument({ id: "4", text: "TypeScript is awesome" });
  await engine.indexDocument({ id: "5", text: "The brown dogs jumps zęf" });

  console.log(engine.index);

  const results = await engine.search("Brown fox");
  console.log(results);
  assertEquals(results.length, 2);
  assertEquals(results[0].id, "1");
  assertEquals(results[0].score, 2);
  assertEquals(results[1].id, "5");
  assertEquals(results[1].score, 1);

  const results2 = await engine.search("jump");
  console.log(results2);
  assertEquals(results2.length, 3);

  await engine.deleteDocument("3");
  const results3 = await engine.search("jump");
  console.log(results3);
  assertEquals(results3.length, 2);

  const results4 = await engine.search("zęf");
  console.log(results4);
  assertEquals(results4.length, 1);
});

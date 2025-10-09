import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import { system } from "@silverbulletmd/silverbullet/syscalls";
import { ftsIndexPage } from "./engine.ts";
import { PromiseQueue } from "@silverbulletmd/silverbullet/lib/async";

// Search indexing is prone to concurrency issues, so we queue all write operations
const promiseQueue = new PromiseQueue();

export async function indexPage({ name, tree }: IndexTreeEvent) {
  if (!await system.getConfig("index.search.enabled", true)) {
    return;
  }
  const text = renderToText(tree);

  return promiseQueue.runInQueue(async () => {
    // console.log("Now FTS indexing", name);
    // await engine.deleteDocument(name);
    await ftsIndexPage(name, text);
  });
}

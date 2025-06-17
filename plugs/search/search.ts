import type {
  IndexTreeEvent,
  PageCreatingContent,
  PageCreatingEvent,
} from "../../type/event.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import { editor } from "@silverbulletmd/silverbullet/syscalls";
import { ftsIndexPage, ftsSearch } from "./engine.ts";
import { PromiseQueue } from "../../lib/async.ts";

const searchPrefix = "search:";

// Search indexing is prone to concurrency issues, so we queue all write operations
const promiseQueue = new PromiseQueue();

export function indexPage({ name, tree }: IndexTreeEvent) {
  const text = renderToText(tree);
  return promiseQueue.runInQueue(async () => {
    // console.log("Now FTS indexing", name);
    // await engine.deleteDocument(name);
    await ftsIndexPage(name, text);
  });
}

export async function searchCommand() {
  const phrase = await editor.prompt("Search for: ");
  if (phrase) {
    await editor.navigate({ kind: "page", page: `${searchPrefix}${phrase}` });
  }
}

export async function readFileSearch(
  { name }: PageCreatingEvent,
): Promise<PageCreatingContent | undefined> {
  if (!name.startsWith(searchPrefix)) {
    return;
  }
  const phrase = name.substring(searchPrefix.length);
  const results = await ftsSearch(phrase);
  const text = `# Search results for "${phrase}"\n${
    results
      .map((r) => `* [[${r.id}]] (score ${r.score})`)
      .join("\n")
  }
    `;

  return {
    text,
    perm: "ro",
  };
}

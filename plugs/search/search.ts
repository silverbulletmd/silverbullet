import type {
  IndexTreeEvent,
  PageCreatingContent,
  PageCreatingEvent,
} from "@silverbulletmd/silverbullet/type/event";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import { editor, system } from "@silverbulletmd/silverbullet/syscalls";
import { ftsIndexPage, ftsSearch } from "./engine.ts";
import { PromiseQueue } from "@silverbulletmd/silverbullet/lib/async";

const searchPrefix = "search:";

// Search indexing is prone to concurrency issues, so we queue all write operations
const promiseQueue = new PromiseQueue();

export async function indexPage({ name, tree }: IndexTreeEvent) {
  if (!await system.getConfig("index.search.enable", true)) {
    return;
  }
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
    await editor.navigate(`${searchPrefix}${phrase}`);
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

import {
  events,
  markdown,
  space,
} from "@silverbulletmd/silverbullet/syscalls";
import type { MQMessage } from "@silverbulletmd/silverbullet/type/datastore";
import type { IndexTreeEvent } from "@silverbulletmd/silverbullet/type/event";

/// QUEUE PROCESSING

export async function processIndexQueue(messages: MQMessage[]) {
  for (const message of messages) {
    const path: string = message.body;
    console.log("[index]", `Indexing file ${path}`);
    await indexFile(path);
  }
}

async function indexFile(path: string) {
  if (path.endsWith(".md")) {
    // Page
    const name = path.slice(0, -3);
    // Read and parse the file
    const { text, meta } = await space.readPageWithMeta(name);
    const tree = await markdown.parseMarkdown(text);

    // Emit the event which will be picked up by indexers
    await events.dispatchEvent("page:index", {
      name,
      meta,
      tree,
      text,
    } as IndexTreeEvent);
  } else {
    await events.dispatchEvent("document:index", path);
  }
}



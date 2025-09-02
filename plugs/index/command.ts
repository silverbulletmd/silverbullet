import {
  editor,
  events,
  markdown,
  mq,
  space,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import type { IndexEvent } from "../../type/event.ts";
import { sleep } from "../../lib/async.ts";
import { indexDocument } from "./document.ts";
import { clearFileIndex } from "./api.ts";
import type { MQMessage } from "../../type/datastore.ts";
import { reindexSpace } from "./queue.ts";

export async function reindexCommand() {
  await editor.flashNotification("Performing full page reindex...");
  await reindexSpace();
  await editor.flashNotification("Done with page index!");
}

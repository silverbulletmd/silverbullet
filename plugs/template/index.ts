import type { IndexTreeEvent } from "$type/types.ts";
import { system } from "$sb/syscalls.ts";

export async function indexTemplate({ name, tree }: IndexTreeEvent) {
  // Just delegate to the index plug
  await system.invokeFunction("index.indexPage", { name, tree });
}

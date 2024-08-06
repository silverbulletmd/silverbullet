import type { IndexTreeEvent } from "../../plug-api/types.ts";
import { system } from "@silverbulletmd/silverbullet/syscalls";

export async function indexTemplate({ name, tree }: IndexTreeEvent) {
  // Just delegate to the index plug
  await system.invokeFunction("index.indexPage", { name, tree });
}

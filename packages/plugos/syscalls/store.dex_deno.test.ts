import { SQLite3 } from "../../../mod.ts";
import { storeSyscalls } from "./store.dex_deno.ts";

Deno.test("store.dex", async () => {
  const db = new SQLite3(":memory:");
  const syscalls = storeSyscalls(db, "test");
  const fakeCtx = {} as any;
  await syscalls["store.put"](fakeCtx, "key", { value: "value" });
});

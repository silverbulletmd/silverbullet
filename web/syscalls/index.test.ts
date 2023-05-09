import { indexedDB } from "https://deno.land/x/indexeddb@v1.1.0/ponyfill_memory.ts";
import { pageIndexSyscalls } from "./index.ts";
import { assertEquals } from "../../test_deps.ts";

Deno.test("Page index", async () => {
  const syscalls = pageIndexSyscalls("test", indexedDB);
  const fakeCtx: any = {};
  await syscalls["index.set"](fakeCtx, "page1", "key", "value");
  // console.log(await syscalls["index.get"](fakeCtx, "page1", "key"));
  //   console.log("here");
});

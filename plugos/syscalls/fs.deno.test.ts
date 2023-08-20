import { FileMeta } from "$sb/types.ts";
import { assert } from "../../test_deps.ts";
import { path } from "../deps.ts";
import fileSystemSyscalls from "./fs.deno.ts";

const fakeCtx = {} as any;

Deno.test("Test FS operations", async () => {
  const thisFolder = path.resolve(
    path.dirname(new URL(import.meta.url).pathname),
  );
  const syscalls = fileSystemSyscalls(thisFolder);
  const allFiles: FileMeta[] = await syscalls["fs.listFiles"](
    fakeCtx,
    thisFolder,
    true,
  );
  assert(allFiles.find((f) => f.name === "fs.deno.test.ts"));
});

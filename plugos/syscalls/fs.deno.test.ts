import { assert } from "../../test_deps.ts";
import { FileMeta } from "../../common/types.ts";
import { path } from "../deps.ts";
import fileSystemSyscalls from "./fs.deno.ts";
import { urlToPathname } from "../util.ts";

const fakeCtx = {} as any;

Deno.test("Test FS operations", async () => {
  const thisFolder = path.resolve(path.dirname(urlToPathname(new URL(import.meta.url))));
  const syscalls = fileSystemSyscalls(thisFolder);
  const allFiles: FileMeta[] = await syscalls["fs.listFiles"](
    fakeCtx,
    thisFolder,
    true,
  );
  assert(allFiles.find((f) => f.name === "fs.deno.test.ts"));
});

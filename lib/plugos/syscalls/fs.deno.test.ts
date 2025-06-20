import { assert } from "@std/assert";
import fileSystemSyscalls from "./fs.deno.ts";
import { dirname, resolve } from "@std/path";
import { fileURLToPath } from "node:url";
import type { FileMeta } from "../../../type/index.ts";

Deno.test("Test FS operations", async () => {
  const thisFolder = resolve(
    dirname(fileURLToPath(new URL(import.meta.url))),
  );
  const syscalls = fileSystemSyscalls(thisFolder);
  const allFiles: FileMeta[] = await syscalls["fs.listFiles"](
    {},
    thisFolder,
    true,
  );
  assert(allFiles.find((f) => f.name === "fs.deno.test.ts"));
});

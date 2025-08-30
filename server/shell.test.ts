import { LocalShell } from "./shell_backend.ts";
import { assert, assertEquals } from "@std/assert";

Deno.test("Test shell backend", async () => {
  const shell = new LocalShell(".");

  // ls test
  let r = await shell.handle({
    cmd: "ls",
    args: [],
  });
  assertEquals(r.code, 0, "successful exit");
  assert(r.stdout.length > 0, "some ls output");

  // cat test
  r = await shell.handle({
    cmd: "cat",
    args: [],
    stdin: "hello",
  });
  assertEquals(r.code, 0, "successful exit");
  assert(r.stdout, "hello");
  console.log("Output", r);
});

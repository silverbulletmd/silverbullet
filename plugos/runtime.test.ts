import path from "https://deno.land/std@0.177.0/node/path.ts";
import { compileManifest } from "./bin/plugos-bundle.ts";
import { createSandbox } from "./environments/deno_sandbox.ts";
import { System } from "./system.ts";
import { assertEquals } from "../test_deps.ts";
import { esbuild } from "./compile.ts";

Deno.test("Run a deno sandbox", async () => {
  const system = new System("server");
  system.registerSyscalls([], {
    addNumbers: (_ctx, a, b) => {
      return a + b;
    },
    failingSyscall: () => {
      throw new Error("#fail");
    },
  });
  system.registerSyscalls(["restricted"], {
    restrictedSyscall: () => {
      return "restricted";
    },
  });
  system.registerSyscalls(["dangerous"], {
    dangerousSyscall: () => {
      return "yay";
    },
  });

  await compileManifest(
    new URL("test.plug.yaml", import.meta.url).pathname,
    path.resolve("."),
  );

  const plug = await system.load(
    new URL("test.plug.js", import.meta.url),
    createSandbox,
  );

  console.log("Plug", plug.manifest);

  assertEquals("hello", await plug.invoke("boot", []));

  await system.unloadAll();

  esbuild.stop();
});

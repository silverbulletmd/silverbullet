import { createSandbox } from "./environments/deno_sandbox.ts";
import { System } from "./system.ts";
import { assertEquals } from "../test_deps.ts";
import { compileManifest } from "./compile.ts";
import { esbuild } from "./deps.ts";

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

  const tempDir = await Deno.makeTempDir();

  const workerPath = await compileManifest(
    new URL("test.plug.yaml", import.meta.url).pathname,
    tempDir,
  );

  const plug = await system.load(
    new URL(`file://${workerPath}`),
    createSandbox,
  );

  console.log("Plug", plug.manifest);

  assertEquals("hello", await plug.invoke("boot", []));

  await system.unloadAll();

  await Deno.remove(tempDir, { recursive: true });

  esbuild.stop();
});

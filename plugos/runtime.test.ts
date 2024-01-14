import { createSandbox } from "./sandboxes/deno_worker_sandbox.ts";
import { System } from "./system.ts";
import { assertEquals } from "../test_deps.ts";
import { compileManifest } from "./compile.ts";
import { esbuild } from "./deps.ts";

Deno.test("Run a deno sandbox", async () => {
  const system = new System("server");
  system.registerSyscalls([], {
    addNumbers: (_ctx, a, b) => {
      console.log("This is the context", _ctx.plug.name);
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
    "test",
    0,
    createSandbox,
  );

  assertEquals({
    addedNumbers: 3,
    yamlMessage: "hello: world\n",
  }, await plug.invoke("boot", []));

  await system.unloadAll();

  // Now load directly from module
  const { plug: plugExport } = await import(
    `file://${workerPath}`
  );

  const plug2 = await system.loadNoSandbox("test", plugExport);

  assertEquals({
    addedNumbers: 3,
    yamlMessage: "hello: world\n",
  }, await plug2.invoke("boot", []));

  await system.unloadAll();

  await Deno.remove(tempDir, { recursive: true });

  esbuild.stop();
});

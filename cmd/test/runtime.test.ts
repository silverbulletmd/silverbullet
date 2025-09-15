import type { SysCallMapping } from "../../lib/plugos/system.ts";
import { System } from "../../lib/plugos/system.ts";
import { assertEquals } from "@std/assert";
import { compileManifest } from "../compile.ts";
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { WorkerSandbox } from "../../lib/plugos/sandboxes/worker_sandbox.ts";

Deno.test("Run a deno sandbox", {
  sanitizeResources: false,
  sanitizeOps: false,
}, async () => {
  const system = new System("server");
  system.registerSyscalls([], {
    addNumbers: (_ctx, a, b) => {
      return a + b;
    },
    failingSyscall: () => {
      throw new Error("#fail");
    },
  } as SysCallMapping);
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
    fileURLToPath(new URL("test_runtime.plug.yaml", import.meta.url)),
    tempDir,
    {
      configPath: fileURLToPath(new URL("../../deno.json", import.meta.url)),
    },
  );

  const plug = await system.loadPlug(
    (plug) => new WorkerSandbox(plug, new URL(`file://${workerPath}`)),
    "test",
  );

  assertEquals({
    addedNumbers: 3,
    jsonMessage: JSON.stringify({ hello: "world" }),
  }, await plug.invoke("boot", []));

  await system.unloadAll();

  await Deno.remove(tempDir, { recursive: true });

  esbuild.stop();
});

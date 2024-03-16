import { createSandbox } from "../../lib/plugos/sandboxes/deno_worker_sandbox.ts";
import { System } from "../../lib/plugos/system.ts";
import { assert, assertEquals } from "$std/testing/asserts.ts";
import { compileManifest } from "../compile.ts";
import * as esbuild from "esbuild";
import {
  createSandbox as createNoSandbox,
  runWithSystemLock,
} from "../../lib/plugos/sandboxes/no_sandbox.ts";
import { SysCallMapping } from "../../lib/plugos/system.ts";
import { sleep } from "../../lib/async.ts";

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
    new URL("test_runtime.plug.yaml", import.meta.url).pathname,
    tempDir,
  );

  const plug = await system.load(
    "test",
    createSandbox(new URL(`file://${workerPath}`)),
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

  const plug2 = await system.load("test", createNoSandbox(plugExport));

  let running = false;
  await Promise.all([
    runWithSystemLock(system, async () => {
      console.log("Starting first run");
      running = true;
      await sleep(5);
      assertEquals({
        addedNumbers: 3,
        yamlMessage: "hello: world\n",
      }, await plug2.invoke("boot", []));
      console.log("Done first run");
      running = false;
    }),
    runWithSystemLock(system, async () => {
      assert(!running);
      console.log("Starting second run");
      assertEquals({
        addedNumbers: 3,
        yamlMessage: "hello: world\n",
      }, await plug2.invoke("boot", []));
      console.log("Done second run");
    }),
  ]);

  await system.unloadAll();

  await Deno.remove(tempDir, { recursive: true });

  esbuild.stop();
});

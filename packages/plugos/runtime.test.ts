import { createSandbox } from "./environments/deno_sandbox.ts";
import { System } from "./system.ts";

import {
  assertEquals,
  assert,
} from "https://deno.land/std@0.158.0/testing/asserts.ts";
import { denoPlugin } from "../esbuild_deno_loader/mod.ts";

Deno.test("Run a deno sandbox", async () => {
  const system = new System("server");
  system.registerSyscalls([], {
    addNumbers: (ctx, a, b) => {
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
  let plug = await system.load(
    {
      name: "test",
      requiredPermissions: ["dangerous"],
      functions: {
        addTen: {
          code: `(() => {
          return {
            default: (n) => {
              return n + 10;
            }
          };
        })()`,
        },
        addNumbersSyscall: {
          code: `(() => {
          return {
            default: async (a, b) => {
              return await self.syscall("addNumbers", a, b);
            }
          };
        })()`,
        },
        errorOut: {
          code: `(() => {
          return {
            default: () => {
              throw Error("BOOM");
            }
          };
        })()`,
        },
        errorOutSys: {
          code: `(() => {
          return {
            default: async () => {
              await self.syscall("failingSyscall");
            }
          };
        })()`,
        },
        restrictedTest: {
          code: `(() => {
          return {
            default: async () => {
              await self.syscall("restrictedSyscall");
            }
          };
        })()`,
        },
        dangerousTest: {
          code: `(() => {
          return {
            default: async () => {
              return await self.syscall("dangerousSyscall");
            }
          };
        })()`,
        },
      },
    },
    createSandbox
  );
  assertEquals(await plug.invoke("addTen", [10]), 20);
  for (let i = 0; i < 100; i++) {
    assertEquals(await plug.invoke("addNumbersSyscall", [10, i]), 10 + i);
  }
  try {
    await plug.invoke("errorOut", []);
    assert(false);
  } catch (e: any) {
    assert(e.message.indexOf("BOOM") !== -1);
  }
  try {
    await plug.invoke("errorOutSys", []);
    assert(false);
  } catch (e: any) {
    assert(e.message.indexOf("#fail") !== -1);
  }
  try {
    await plug.invoke("restrictedTest", []);
    assert(false);
  } catch (e: any) {
    assert(
      e.message.indexOf(
        "Missing permission 'restricted' for syscall restrictedSyscall"
      ) !== -1
    );
  }
  assertEquals(await plug.invoke("dangerousTest", []), "yay");

  await system.unloadAll();
});

import { run as bundleRun } from "./bin/plugos-bundle.ts";
import { esbuild } from "./compile.ts";
import { safeRun } from "./util.ts";
const __dirname = new URL(".", import.meta.url).pathname;

Deno.test("Preload dependencies", async () => {
  const tmpDist = `${__dirname}tmp_dist`;
  await bundleRun({
    _: [`${__dirname}../plugs/global.plug.yaml`],
    debug: true,
    dist: tmpDist,
    exclude: [],
  });
  const globalModules = JSON.parse(
    Deno.readTextFileSync(`${tmpDist}/global.plug.json`)
  );
  await bundleRun({
    _: [`${__dirname}test.plug.yaml`],
    debug: true,
    dist: tmpDist,
    exclude: Object.keys(globalModules.dependencies),
  });
  esbuild.stop();

  const system = new System("server");
  system.on({
    plugLoaded: async (plug) => {
      for (let [modName, code] of Object.entries(globalModules.dependencies)) {
        await plug.sandbox.loadDependency(modName, code as string);
      }
    },
  });

  // Load test module
  console.log("Loading test module");
  const testPlug = await system.load(
    JSON.parse(Deno.readTextFileSync(`${tmpDist}/test.plug.json`)),
    createSandbox
  );
  console.log("Running");

  const result = await testPlug.invoke("boot", []);

  console.log("Result", result);

  await system.unloadAll();

  Deno.removeSync(tmpDist, { recursive: true });
});

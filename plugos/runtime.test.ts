import { sandboxFactory } from "./environments/deno_sandbox.ts";
import { System } from "./system.ts";

import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.158.0/testing/asserts.ts";

import assetBundle from "../dist/asset_bundle.json" assert { type: "json" };
Deno.test("Run a deno sandbox", async () => {
  const createSandbox = sandboxFactory(assetBundle as AssetBundle);

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
  const plug = await system.load(
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
    createSandbox,
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
        "Missing permission 'restricted' for syscall restrictedSyscall",
      ) !== -1,
    );
  }
  assertEquals(await plug.invoke("dangerousTest", []), "yay");

  await system.unloadAll();
});

import { bundle as plugOsBundle } from "./bin/plugos-bundle.ts";
import { esbuild } from "./compile.ts";
import { AssetBundle } from "./asset_bundle_reader.ts";
const __dirname = new URL(".", import.meta.url).pathname;

Deno.test("Preload dependencies", async () => {
  const createSandbox = sandboxFactory(assetBundle as AssetBundle);

  const globalModules = await plugOsBundle(
    `${__dirname}../plugs/global.plug.yaml`,
  );
  // const globalModules = JSON.parse(
  //   Deno.readTextFileSync(`${tmpDist}/global.plug.json`),
  // );
  const testPlugManifest = await plugOsBundle(
    `${__dirname}test.plug.yaml`,
    { excludeModules: Object.keys(globalModules.dependencies!) },
  );
  esbuild.stop();

  const system = new System("server");
  system.on({
    plugLoaded: async (plug) => {
      for (
        const [modName, code] of Object.entries(globalModules.dependencies!)
      ) {
        await plug.sandbox.loadDependency(modName, code as string);
      }
    },
  });

  // Load test module
  console.log("Loading test module");
  const testPlug = await system.load(
    testPlugManifest,
    createSandbox,
  );
  console.log("Running");

  const result = await testPlug.invoke("boot", []);

  console.log("Result", result);

  await system.unloadAll();
});

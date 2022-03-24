import { createSandbox } from "./environment/node_sandbox";
import { expect, test } from "@jest/globals";
import { System } from "./system";

test("Run a Node sandbox", async () => {
  let system = new System("server");
  system.registerSyscalls({
    addNumbers: (a, b) => {
      return a + b;
    },
    failingSyscall: () => {
      throw new Error("#fail");
    },
  });
  let plug = await system.load(
    "test",
    {
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
      },
      hooks: {
        events: {},
      },
    },
    createSandbox(system)
  );
  expect(await plug.invoke("addTen", [10])).toBe(20);
  for (let i = 0; i < 100; i++) {
    expect(await plug.invoke("addNumbersSyscall", [10, i])).toBe(10 + i);
  }
  try {
    await plug.invoke("errorOut", []);
    expect(true).toBe(false);
  } catch (e: any) {
    expect(e.message).toBe("BOOM");
  }
  try {
    await plug.invoke("errorOutSys", []);
    expect(true).toBe(false);
  } catch (e: any) {
    expect(e.message).toBe("#fail");
  }
  await system.unloadAll();
});

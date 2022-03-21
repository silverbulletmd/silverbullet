import { createSandbox } from "./node_sandbox";
import { System } from "./runtime";
import { test, expect } from "@jest/globals";

test("Run a Node sandbox", async () => {
  let system = new System();
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
              return await self.syscall(1, "addNumbers", [a, b]);
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
              await self.syscall(2, "failingSyscall", []);
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

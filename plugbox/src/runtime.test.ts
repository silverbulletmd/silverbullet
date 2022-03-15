import { NodeSandbox } from "./node_sandbox";
import { System } from "./runtime";
import { test, expect } from "@jest/globals";

test("Run a Node sandbox", async () => {
  let system = new System();
  system.registerSyscalls({
    addNumbers: (a, b) => {
      return a + b;
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
              return await(syscall("addNumbers", [a, b]));
            }
          };
        })()`,
        },
      },
      hooks: {
        events: {},
      },
    },
    new NodeSandbox(system, __dirname + "/../dist/node_worker.js")
  );
  expect(await plug.invoke("addTen", [10])).toBe(20);
  for (let i = 0; i < 100; i++) {
    expect(await plug.invoke("addNumbersSyscall", [10, i])).toBe(10 + i);
  }
  // console.log(plug.sandbox);
  await system.stop();
});

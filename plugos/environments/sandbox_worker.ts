// IMPORTANT: After modifiying this file, run `deno task generate` in the SB root to regenerate the asset bundle (`worker_bundle.json`), which will be imported for the runtime.
import { safeRun } from "../util.ts";
import { ConsoleLogger } from "./custom_logger.ts";
import type { ControllerMessage, WorkerMessage } from "./worker.ts";

if (typeof Deno === "undefined") {
  // @ts-ignore: Deno hack
  self.Deno = {
    args: [],
    // @ts-ignore: Deno hack
    build: {
      arch: "x86_64",
    },
    env: {
      // @ts-ignore: Deno hack
      get() {
      },
    },
  };
}

// deno-lint-ignore ban-types
const loadedFunctions = new Map<string, Function>();
const pendingRequests = new Map<
  number,
  {
    resolve: (result: unknown) => void;
    reject: (e: any) => void;
  }
>();

function workerPostMessage(msg: ControllerMessage) {
  if (typeof window !== "undefined" && window.parent !== window) {
    window.parent.postMessage(msg, "*");
  } else {
    self.postMessage(msg);
  }
}

declare global {
  function syscall(name: string, ...args: any[]): Promise<any>;
  // function require(moduleName: string): any;
}

let syscallReqId = 0;

self.syscall = async (name: string, ...args: any[]) => {
  return await new Promise((resolve, reject) => {
    syscallReqId++;
    pendingRequests.set(syscallReqId, { resolve, reject });
    workerPostMessage({
      type: "syscall",
      id: syscallReqId,
      name,
      args,
    });
  });
};

const loadedModules = new Map<string, any>();

// @ts-ignore: global to load dynamic imports
self.require = (moduleName: string): any => {
  // console.log("Requiring", moduleName, loadedModules.get(moduleName));
  const mod = loadedModules.get(moduleName);
  if (!mod) {
    throw new Error(
      `Dynamically importing non-preloaded library ${moduleName}`,
    );
  }
  return mod;
};

// @ts-ignore: global overwrite on purpose
self.console = new ConsoleLogger((level, message) => {
  workerPostMessage({ type: "log", level, message });
}, false);

function wrapScript(code: string) {
  return `return (${code})["default"]`;
}

self.addEventListener("message", (event: { data: WorkerMessage }) => {
  safeRun(async () => {
    const data = event.data;
    switch (data.type) {
      case "load":
        {
          let fn2 = new Function(wrapScript(data.code!));
          loadedFunctions.set(data.name!, fn2());
          workerPostMessage({
            type: "inited",
            name: data.name,
          });
        }

        break;
      case "load-dependency":
        {
          // console.log("Received dep", data.name);
          let fn3 = new Function(`return ${data.code!}`);
          let v = fn3();
          loadedModules.set(data.name!, v);
          // console.log("Dep val", v);
          workerPostMessage({
            type: "dependency-inited",
            name: data.name,
          });
        }
        break;
      case "invoke":
        {
          let fn = loadedFunctions.get(data.name!);
          if (!fn) {
            throw new Error(`Function not loaded: ${data.name}`);
          }
          try {
            let result = await Promise.resolve(fn(...(data.args || [])));
            workerPostMessage({
              type: "result",
              id: data.id,
              result: result,
            } as ControllerMessage);
          } catch (e: any) {
            workerPostMessage({
              type: "result",
              id: data.id,
              error: e.message,
              stack: e.stack,
            });
            // console.error("Error invoking function", data.name, e.message);
            // throw e;
          }
        }

        break;
      case "syscall-response":
        {
          let syscallId = data.id!;
          const lookup = pendingRequests.get(syscallId);
          if (!lookup) {
            console.log(
              "Current outstanding requests",
              pendingRequests,
              "looking up",
              syscallId,
            );
            throw Error("Invalid request id");
          }
          pendingRequests.delete(syscallId);
          if (data.error) {
            lookup.reject(new Error(data.error));
          } else {
            lookup.resolve(data.result);
          }
        }

        break;
    }
  });
});

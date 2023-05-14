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
  console.log("Requiring", moduleName);
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

export function setupMessageListener(
  // deno-lint-ignore ban-types
  functionMapping: Record<string, Function>,
  manifest: Manifest,
) {
  self.addEventListener("message", (event: { data: WorkerMessage }) => {
    safeRun(async () => {
      const data = event.data;
      switch (data.type) {
        case "invoke":
          {
            const fn = functionMapping[data.name!];
            if (!fn) {
              throw new Error(`Function not loaded: ${data.name}`);
            }
            try {
              const result = await Promise.resolve(fn(...(data.args || [])));
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
            const syscallId = data.id!;
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
  // Signal initialization with manifest
  workerPostMessage({
    type: "inited",
    manifest,
  });
}

import { monkeyPatchFetch } from "../../plug-api/plugos-syscall/fetch.ts";
import { Manifest } from "../../common/manifest.ts";

monkeyPatchFetch();

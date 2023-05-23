// This is the runtime imported from the compiled plug worker code

import type { ControllerMessage, WorkerMessage } from "./protocol.ts";
import type { Manifest } from "../common/manifest.ts";

declare global {
  function syscall(name: string, ...args: any[]): Promise<any>;
}

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

let syscallReqId = 0;

function workerPostMessage(msg: ControllerMessage) {
  self.postMessage(msg);
}

self.syscall = async (name: string, ...args: any[]) => {
  return await new Promise((resolve, reject) => {
    syscallReqId++;
    pendingRequests.set(syscallReqId, { resolve, reject });
    workerPostMessage({
      type: "sys",
      id: syscallReqId,
      name,
      args,
    });
  });
};

export function setupMessageListener(
  // deno-lint-ignore ban-types
  functionMapping: Record<string, Function>,
  manifest: Manifest,
) {
  self.addEventListener("message", (event: { data: WorkerMessage }) => {
    (async () => {
      const data = event.data;
      switch (data.type) {
        case "inv":
          {
            const fn = functionMapping[data.name!];
            if (!fn) {
              throw new Error(`Function not loaded: ${data.name}`);
            }
            try {
              const result = await Promise.resolve(fn(...(data.args || [])));
              workerPostMessage({
                type: "invr",
                id: data.id,
                result: result,
              } as ControllerMessage);
            } catch (e: any) {
              console.error(e);
              workerPostMessage({
                type: "invr",
                id: data.id!,
                error: e.message,
              });
            }
          }

          break;
        case "sysr":
          {
            const syscallId = data.id;
            const lookup = pendingRequests.get(syscallId);
            if (!lookup) {
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
    })().catch(console.error);
  });
  // Signal initialization with manifest
  workerPostMessage({
    type: "manifest",
    manifest,
  });
}

// Monkey patch fetch()
import { monkeyPatchFetch } from "../plug-api/plugos-syscall/fetch.ts";
monkeyPatchFetch();

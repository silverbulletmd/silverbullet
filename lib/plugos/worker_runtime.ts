// This is the runtime imported from the compiled plug worker code
import type { ControllerMessage, WorkerMessage } from "./protocol.ts";
import type {
  ProxyFetchRequest64,
  ProxyFetchResponse64,
} from "../proxy_fetch.ts";
import { base64Decode, base64Encode } from "../crypto.ts";

declare global {
  function syscall(name: string, ...args: any[]): Promise<any>;
}

let workerPostMessage = (_msg: ControllerMessage): void => {
  throw new Error("Not initialized yet");
};

// Are we running in a (web) worker?

// Determines if we're running in a web worker environment (Deno or browser)
// - in a browser's main threads, typeof window is "object"
// - in a browser's worker threads, typeof window === "undefined"
// - in Deno's main thread typeof window === "object"
// - in Deno's workers typeof window === "undefined
// - in Cloudflare workers typeof window === "undefined", but typeof globalThis.WebSocketPair is defined
const runningAsWebWorker = typeof window === "undefined" &&
  // @ts-ignore: globalThis
  typeof globalThis.WebSocketPair === "undefined";

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

if (runningAsWebWorker) {
  globalThis.syscall = async (name: string, ...args: any[]) => {
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
}

export function setupMessageListener(
  // deno-lint-ignore ban-types
  functionMapping: Record<string, Function>,
  manifest: any,
  postMessageFn: (msg: ControllerMessage) => void,
) {
  if (!runningAsWebWorker) {
    // Don't do any of this stuff if this is not a web worker
    // This caters to the NoSandbox run mode
    return;
  }
  workerPostMessage = postMessageFn;
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
              console.error(
                "An exception was thrown as a result of invoking function",
                data.name,
                "error:",
                e.message,
              );
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

export async function sandboxFetch(
  reqInfo: RequestInfo,
  options?: ProxyFetchRequest64,
): Promise<ProxyFetchResponse64> {
  if (typeof reqInfo !== "string") {
    const body = new Uint8Array(await reqInfo.arrayBuffer());
    const encodedBody = body.length > 0 ? base64Encode(body) : undefined;
    options = {
      method: reqInfo.method,
      headers: Object.fromEntries(reqInfo.headers.entries()),
      base64Body: encodedBody,
    };
    reqInfo = reqInfo.url;
  }
  return syscall("sandboxFetch.fetch", reqInfo, options);
}

// @ts-ignore: monkey patching fetch
globalThis.nativeFetch = globalThis.fetch;

// Monkey patch fetch()
export function monkeyPatchFetch() {
  // @ts-ignore: monkey patching fetch
  globalThis.fetch = async function (
    reqInfo: RequestInfo,
    init?: RequestInit,
  ): Promise<Response> {
    const encodedBody = init && init.body
      ? base64Encode(
        new Uint8Array(await (new Response(init.body)).arrayBuffer()),
      )
      : undefined;
    const r = await sandboxFetch(
      reqInfo,
      init && {
        method: init.method,
        headers: init.headers as Record<string, string>,
        base64Body: encodedBody,
      },
    );
    // Casting the response to "any" for now, since of weird Deno typing
    return new Response(
      (r.base64Body ? base64Decode(r.base64Body) : null) as any,
      {
        status: r.status,
        headers: r.headers,
      },
    );
  };
}

if (runningAsWebWorker) {
  monkeyPatchFetch();
}

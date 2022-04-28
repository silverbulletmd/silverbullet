import { safeRun } from "../util";
import { ControllerMessage, WorkerMessage } from "./worker";

let loadedFunctions = new Map<string, Function>();
let pendingRequests = new Map<
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

const preloadedModules: { [key: string]: any } = {
  "@lezer/lr": require("@lezer/lr"),
  yaml: require("yaml"),
  handlebars: require("handlebars/dist/handlebars"),
};
// for (const moduleName of preloadModules) {
//   preloadedModules[moduleName] = require(moduleName);
// }

// @ts-ignore
self.require = (moduleName: string): any => {
  // console.log("Loading", moduleName, preloadedModules[moduleName]);
  return preloadedModules[moduleName];
};

function wrapScript(code: string) {
  return `return (${code})["default"]`;
}

self.addEventListener("message", (event: { data: WorkerMessage }) => {
  safeRun(async () => {
    let data = event.data;
    switch (data.type) {
      case "load":
        let fn2 = new Function(wrapScript(data.code!));
        loadedFunctions.set(data.name!, fn2());
        workerPostMessage({
          type: "inited",
          name: data.name,
        });
        break;
      case "invoke":
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
          });
          throw e;
        }

        break;
      case "syscall-response":
        let syscallId = data.id!;
        const lookup = pendingRequests.get(syscallId);
        if (!lookup) {
          console.log(
            "Current outstanding requests",
            pendingRequests,
            "looking up",
            syscallId
          );
          throw Error("Invalid request id");
        }
        pendingRequests.delete(syscallId);
        if (data.error) {
          lookup.reject(new Error(data.error));
        } else {
          lookup.resolve(data.result);
        }
        break;
    }
  });
});

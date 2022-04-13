import { preloadModules } from "../../common/preload_modules";

const { parentPort, workerData } = require("worker_threads");
// @ts-ignore
let vm2 = `${workerData}/vm2`;
const { VM, VMScript } = require(vm2);

// console.log("Process env", process.env);

let loadedFunctions = new Map<string, Function>();
let pendingRequests = new Map<
  number,
  {
    resolve: (result: unknown) => void;
    reject: (e: any) => void;
  }
>();

let syscallReqId = 0;

let vm = new VM({
  sandbox: {
    console,
    require: (moduleName: string): any => {
      console.log("Loading", moduleName);
      if (preloadModules.includes(moduleName)) {
        return require(`${workerData}/${moduleName}`);
      } else {
        throw Error("Cannot import arbitrary modules");
      }
    },
    self: {
      syscall: (name: string, ...args: any[]) => {
        return new Promise((resolve, reject) => {
          syscallReqId++;
          pendingRequests.set(syscallReqId, { resolve, reject });
          parentPort.postMessage({
            type: "syscall",
            id: syscallReqId,
            name,
            // TODO: Figure out why this is necessary (to avoide a CloneError)
            args: JSON.parse(JSON.stringify(args)),
          });
        });
      },
    },
  },
});

function wrapScript(code: string) {
  return `(${code})["default"]`;
}

function safeRun(fn: any) {
  fn().catch((e: any) => {
    console.error(e);
  });
}

parentPort.on("message", (data: any) => {
  safeRun(async () => {
    switch (data.type) {
      case "load":
        loadedFunctions.set(data.name, new VMScript(wrapScript(data.code)));
        parentPort.postMessage({
          type: "inited",
          name: data.name,
        });
        break;
      case "invoke":
        let fn = loadedFunctions.get(data.name);
        if (!fn) {
          throw new Error(`Function not loaded: ${data.name}`);
        }
        try {
          let r = vm.run(fn);
          let result = await Promise.resolve(r(...data.args));
          parentPort.postMessage({
            type: "result",
            id: data.id,
            // TOOD: Figure out if this is necessary, because it's expensive
            result: result && JSON.parse(JSON.stringify(result)),
          });
        } catch (e: any) {
          parentPort.postMessage({
            type: "result",
            id: data.id,
            error: e.message,
          });
        }
        break;
      case "syscall-response":
        let syscallId = data.id;
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
          console.log("Got rejection", data.error);
          lookup.reject(new Error(data.error));
        } else {
          lookup.resolve(data.result);
        }
        break;
    }
  });
});

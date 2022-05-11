import { ConsoleLogger } from "./custom_logger";

const {
  parentPort,
  workerData: { preloadedModules, nodeModulesPath },
} = require("worker_threads");

const { VM, VMScript } = require(`${nodeModulesPath}/vm2`);

let loadedFunctions = new Map<string, Function>();
let pendingRequests = new Map<
  number,
  {
    resolve: (result: unknown) => void;
    reject: (e: any) => void;
  }
>();

let syscallReqId = 0;

let consoleLogger = new ConsoleLogger((level, message) => {
  parentPort.postMessage({
    type: "log",
    level,
    message,
  });
}, false);

let vm = new VM({
  sandbox: {
    // Exposing some "safe" APIs
    console: consoleLogger,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: require(`${nodeModulesPath}/node-fetch`),
    WebSocket: require(`${nodeModulesPath}/ws`),
    // This is only going to be called for pre-bundled modules, we won't allow
    // arbitrary requiring of modules
    require: (moduleName: string): any => {
      // console.log("Loading", moduleName);
      if (preloadedModules.includes(moduleName)) {
        return require(`${nodeModulesPath}/${moduleName}`);
      } else {
        throw Error(`Cannot import arbitrary modules like ${moduleName}`);
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

process.on("uncaughtException", (e) => {
  console.error("Uncaught error", e);
});

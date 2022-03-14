import { VM, VMScript } from "vm2";
import { parentPort } from "worker_threads";

let loadedFunctions = new Map();
let pendingRequests = new Map();

let reqId = 0; // Syscall request ID

let vm = new VM({
  sandbox: {
    console: console,
    syscall: (name: string, args: any[]) => {
      return new Promise((resolve, reject) => {
        reqId++;
        pendingRequests.set(reqId, resolve);
        parentPort!.postMessage({
          type: "syscall",
          id: reqId,
          name,
          // TODO: Figure out why this is necessary (to avoide a CloneError)
          args: JSON.parse(JSON.stringify(args)),
        });
      });
    },
  },
});

function wrapScript(code: string) {
  return `${code}["default"]`;
}

function safeRun(fn: () => Promise<any>) {
  fn().catch((e) => {
    console.error(e);
  });
}

parentPort!.on("message", (data) => {
  safeRun(async () => {
    switch (data.type) {
      case "load":
        console.log("Booting", data.name);
        loadedFunctions.set(data.name, new VMScript(wrapScript(data.code)));
        parentPort!.postMessage({
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
          parentPort!.postMessage({
            type: "result",
            id: data.id,
            result: result,
          });
        } catch (e: any) {
          parentPort!.postMessage({
            type: "error",
            id: data.id,
            reason: e.message,
          });
          throw e;
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
        lookup(data.data);
        break;
    }
  });
});

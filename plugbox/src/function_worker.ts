declare global {
  function syscall(id: string, name: string, args: any[]): Promise<any>;
}
import { safeRun } from "./util";
let func: Function | null = null;
let pendingRequests = new Map<string, (result: unknown) => void>();

self.syscall = async (id: string, name: string, args: any[]) => {
  return await new Promise((resolve, reject) => {
    pendingRequests.set(id, resolve);
    self.postMessage({
      type: "syscall",
      id,
      name,
      args,
    });
  });
};

self.addEventListener("result", (event) => {
  let customEvent = event as CustomEvent;
  self.postMessage({
    type: "result",
    result: customEvent.detail,
  });
});

self.addEventListener("app-error", (event) => {
  let customEvent = event as CustomEvent;
  self.postMessage({
    type: "error",
    reason: customEvent.detail,
  });
});

function wrapScript(code: string): string {
  return `const fn = ${code};
return fn["default"].apply(null, arguments);`;
}

self.addEventListener("message", (event) => {
  safeRun(async () => {
    let messageEvent = event;
    let data = messageEvent.data;
    switch (data.type) {
      case "boot":
        console.log("Booting", data.name);
        func = new Function(wrapScript(data.code));
        self.postMessage({
          type: "inited",
        });
        break;
      case "invoke":
        if (!func) {
          throw new Error("No function loaded");
        }
        try {
          let result = await Promise.resolve(func(...(data.args || [])));
          self.postMessage({
            type: "result",
            result: result,
          });
        } catch (e: any) {
          self.postMessage({
            type: "error",
            reason: e.message,
          });
          throw e;
        }

        break;
      case "syscall-response":
        let id = data.id;
        const lookup = pendingRequests.get(id);
        if (!lookup) {
          console.log(
            "Current outstanding requests",
            pendingRequests,
            "looking up",
            id
          );
          throw Error("Invalid request id");
        }
        pendingRequests.delete(id);
        lookup(data.data);
    }
  });
});

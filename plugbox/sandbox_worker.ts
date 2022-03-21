import { ControllerMessage, WorkerMessage, WorkerMessageType } from "./types";
import { safeRun } from "./util";

let loadedFunctions = new Map<string, Function>();
let pendingRequests = new Map<
  number,
  {
    resolve: (result: unknown) => void;
    reject: (e: any) => void;
  }
>();

declare global {
  function syscall(id: number, name: string, args: any[]): Promise<any>;
}

let postMessage = self.postMessage.bind(self);

if (window.parent !== window) {
  postMessage = window.parent.postMessage.bind(window.parent);
}

self.syscall = async (id: number, name: string, args: any[]) => {
  return await new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    postMessage(
      {
        type: "syscall",
        id,
        name,
        args,
      },
      "*"
    );
  });
};

function wrapScript(code: string): string {
  return `const fn = ${code};
return fn["default"].apply(null, arguments);`;
}

self.addEventListener("message", (event: { data: WorkerMessage }) => {
  safeRun(async () => {
    let messageEvent = event;
    let data = messageEvent.data;
    switch (data.type) {
      case "load":
        console.log("Booting", data.name);
        loadedFunctions.set(data.name!, new Function(wrapScript(data.code!)));
        postMessage(
          {
            type: "inited",
            name: data.name,
          } as ControllerMessage,
          "*"
        );
        break;
      case "invoke":
        let fn = loadedFunctions.get(data.name!);
        if (!fn) {
          throw new Error(`Function not loaded: ${data.name}`);
        }
        try {
          let result = await Promise.resolve(fn(...(data.args || [])));
          postMessage(
            {
              type: "result",
              id: data.id,
              result: result,
            } as ControllerMessage,
            "*"
          );
        } catch (e: any) {
          postMessage(
            {
              type: "result",
              id: data.id,
              error: e.message,
            } as ControllerMessage,
            "*"
          );
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

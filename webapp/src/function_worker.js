// Page: this file is not built by Parcel, it's simply copied to the distribution
// The reason is that somehow Parcel cannot accept using importScripts otherwise
function safeRun(fn) {
  fn().catch((e) => {
    console.error(e);
  });
}

let func = null;
let pendingRequests = {};

self.addEventListener("syscall", (event) => {
  let customEvent = event;
  let detail = customEvent.detail;
  pendingRequests[detail.id] = detail.callback;
  self.postMessage({
    type: "syscall",
    id: detail.id,
    name: detail.name,
    args: detail.args,
  });
});

self.addEventListener("result", (event) => {
  let customEvent = event;
  self.postMessage({
    type: "result",
    result: customEvent.detail,
  });
});

self.addEventListener("app-error", (event) => {
  let customEvent = event;
  self.postMessage({
    type: "error",
    reason: customEvent.detail,
  });
});

self.addEventListener("message", (event) => {
  safeRun(async () => {
    let messageEvent = event;
    let data = messageEvent.data;
    switch (data.type) {
      case "boot":
        console.log("Booting", `${data.prefix}/function/${data.name}`);
        importScripts(`${data.prefix}/function/${data.name}`);
        self.postMessage({
          type: "inited",
        });
        break;
      case "invoke":
        self.dispatchEvent(
          new CustomEvent("invoke-function", {
            detail: {
              args: data.args || [],
            },
          })
        );
        break;
      case "syscall-response":
        let id = data.id;
        const lookup = pendingRequests[id];
        if (!lookup) {
          console.log(
            "Current outstanding requests",
            pendingRequests,
            "looking up",
            id
          );
          throw Error("Invalid request id");
        }
        return await lookup(data.data);
    }
  });
});

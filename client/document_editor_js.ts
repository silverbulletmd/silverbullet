export default `
const pendingRequests = new Map();
let requestID = 0;

globalThis.silverbullet = new EventTarget();

globalThis.silverbullet.syscall = (name, ...args) => {
  const promise = Promise.withResolvers();

  pendingRequests.set(++requestID, { ...promise });

  globalThis.parent.postMessage({
    type: "syscall",
    data: {
      id: requestID,
      name,
      args,
    },
  }, "*");

  return promise.promise;
};

globalThis.addEventListener("message", (message) => {
  const response = message.data, data = message.data.data;

  // Passthrough non internal events
  if (!response.internal) {
    globalThis.silverbullet.dispatchEvent(new CustomEvent(response.type, { detail: data }));
    return;
  }

  switch (response.type) {
    case "syscall-response": {
      const id = data.id;
      const request = pendingRequests.get(id);
      if (!request) {
        console.error(\`Failed to lookup request with id \${id}\`);
        throw Error("Invalid request id");
      }

      pendingRequests.delete(id);

      if (data.error) {
        request.reject(new Error(data.error));
      } else {
        request.resolve(data.result);
      }
    } break;
    case "set-theme": {
      document.querySelector("html").setAttribute("data-theme", data.theme);
    } break;
  }
});

globalThis.silverbullet.sendMessage = (type, data) => {
  globalThis.parent.postMessage({ type, data }, "*");
};

// When an iframe is focused, all keyboard events will be captured by the
// iframe. This is bad because we obviously want stuff like the command
// picker to keep working. This is done by listening to the event **in the
// capture phase** (so we get it first), sending it to the actual SB DOM,
// and only if it doesn't have defaultPrevented set, we send it further
// down.
globalThis.addEventListener("keydown", (event) => {
  // This is really hacky... open to other solutions
  const keyEvent = new KeyboardEvent("keydown", event);

  Object.defineProperty(keyEvent, "target", {
    value: globalThis.parent.document.body,
  });

  globalThis.parent.document.dispatchEvent(keyEvent);

  if (keyEvent.defaultPrevented) {
    event.preventDefault();
    event.stopPropagation();
  }
}, true);
`;

globalThis.addEventListener("unhandledrejection", (event) => {
  client.reportError(event.reason);
});

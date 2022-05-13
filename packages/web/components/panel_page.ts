window.addEventListener("message", (message) => {
  const data = message.data;
  switch (data.type) {
    case "html":
      document.body.innerHTML = data.html;
      if (data.script) {
        try {
          eval(data.script);
        } catch (e: any) {
          console.error("Error evaling script", e);
        }
      }
      break;
  }
});

function sendEvent(name: string, ...args: any[]) {
  window.parent.postMessage(
    {
      type: "event",
      name,
      args,
    },
    "*"
  );
}
//
// setInterval(() => {
//   self.sendEvent("testing");
// }, 2000);

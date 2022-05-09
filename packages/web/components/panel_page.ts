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

function sendEvent(data: any) {
  window.parent.postMessage(
    {
      type: "event",
      data: data,
    },
    "*"
  );
}
//
// setInterval(() => {
//   self.sendEvent("testing");
// }, 2000);

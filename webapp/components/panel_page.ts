window.addEventListener("message", (message) => {
  const data = message.data;
  switch (data.type) {
    case "html":
      document.body.innerHTML = data.html;
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

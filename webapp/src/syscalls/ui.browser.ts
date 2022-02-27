// @ts-ignore
let frameTest = document.getElementById("main-frame");

window.addEventListener("message", async (event) => {
  let messageEvent = event as MessageEvent;
  let data = messageEvent.data;
  if (data.type === "iframe_event") {
    // @ts-ignore
    window.mainPlugin.dispatchEvent(data.data.event, data.data.data);
  }
});

export default {
  "ui.update": function (doc: any) {
    // frameTest.contentWindow.postMessage({
    //     type: "loadContent",
    //     doc: doc,
    // });
  },
};

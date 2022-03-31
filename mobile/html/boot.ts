declare namespace window {
  var ReactNativeWebView: any;
  var receiveMessage: any;
}

function safeRun(fn: () => Promise<void>) {
  fn().catch((e) => {
    console.error(e);
  });
}

window.receiveMessage = (msg: string) => {
  console.log("Received message", msg);
};
// @ts-ignore
window.onerror = (msg, source, lineno, colno, error) => {
  console.error("Error", msg, source, lineno, error);
};

console.log = (...args) => {
  window.ReactNativeWebView.postMessage(
    JSON.stringify({ type: "console.log", args: args })
  );
};

console.error = (...args) => {
  window.ReactNativeWebView.postMessage(
    JSON.stringify({ type: "console.error", args: args })
  );
};
try {
  // let editor = new Editor(
  //   new Space(`http://192.168.2.22:3000/fs`, null),
  //   document.getElementById("root")!
  // );
  // console.log("Initing editor");
  // safeRun(async () => {
  //   await editor.loadPageList();
  //   await editor.loadPlugs();
  //   editor.focus();
  //   console.log("Inited", editor.viewState);
  // });
} catch (e: any) {
  console.error("Got an error", e.message);
}

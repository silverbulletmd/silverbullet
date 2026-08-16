export const panelHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <base target="_top" href="{{.HostPrefix}}">
    <meta name='color-scheme' content='dark light'>
<script>
const pendingRequests = new Map();
let syscallReqId = 0;

globalThis.syscall = async (name, ...args) => {
  return await new Promise((resolve, reject) => {
    syscallReqId++;
    pendingRequests.set(syscallReqId, { resolve, reject });
    globalThis.parent.postMessage({
      type: "syscall",
      id: syscallReqId,
      name,
      args,
    }, "*");
  });
};

let oldHeight = undefined;
let heightChecks = 0;

const eventHandlers = new Map();
globalThis.sbEvent = {
  on(name, cb) {
    if (!eventHandlers.has(name)) eventHandlers.set(name, []);
    eventHandlers.get(name).push(cb);
  },
};

// Whether the host is below its mobile breakpoint
globalThis.sbMobile = false;

// Ctrl/Cmd(-ish) chords the host currently has a command bound to, pushed
// ahead of time so a panel can preventDefault a chord's browser default
// synchronously -- its own forward to the host is fire-and-forget and can't
// answer back in time to do it. See client/lib/bound_chords.ts.
globalThis.sbBoundChords = [];

function dispatchPanelEvent(name, args) {
  for (const cb of eventHandlers.get(name) || []) {
    try {
      cb(...(args || []));
    } catch (e) {
      console.error("sbEvent handler error", e);
    }
  }
}

globalThis.addEventListener("message", (message) => {
  const data = message.data;
  switch (data.type) {
    case "html":
      document.body.innerHTML = data.html;
      // Before the script is eval'd below, so a panel can read it on boot.
      if (typeof data.mobile === "boolean") {
        globalThis.sbMobile = data.mobile;
      }
      if (Array.isArray(data.boundChords)) {
        globalThis.sbBoundChords = data.boundChords;
      }
      if(data.theme) {
        document.getElementsByTagName("html")[0].setAttribute("data-theme", data.theme);
      }
      if (data.script) {
        try {
          eval(data.script);
        } catch (e) {
          console.error("Error evaling script", e);
        }
      }
      setTimeout(() => {
        oldHeight = undefined;
        heightChecks = 0;
        updateHeight();
      });
      break;
    case "syscall-response":
      {
        const syscallId = data.id;
        const lookup = pendingRequests.get(syscallId);
        if (!lookup) {
          console.log(
            "Current outstanding requests",
            pendingRequests,
            "looking up",
            syscallId,
          );
          throw Error("Invalid request id");
        }
        pendingRequests.delete(syscallId);
        if (data.error) {
          lookup.reject(new Error(data.error));
        } else {
          lookup.resolve(data.result);
        }
      }

      break;
    case "event":
      dispatchPanelEvent(data.name, data.args);
      break;
    case "theme":
      if (data.theme) {
        document.documentElement.setAttribute("data-theme", data.theme);
      }
      break;
    case "panel:mobile":
      globalThis.sbMobile = !!data.mobile;
      dispatchPanelEvent("panel:mobile", [globalThis.sbMobile]);
      break;
    case "bound-chords":
      globalThis.sbBoundChords = data.chords || [];
      break;
    case "panel:shown":
    case "panel:hidden":
      dispatchPanelEvent(data.type, []);
      break;
  }
});

function updateHeight() {
  const body = document.body, html = document.documentElement;
  let height = Math.max(body.offsetHeight, html.offsetHeight);
  heightChecks++;
  if(height !== oldHeight) {
    oldHeight = height;
    globalThis.parent.postMessage({
      type: "setHeight",
      height: height,
    });
  }
  if(heightChecks < 25) {
    setTimeout(updateHeight, 100);
  }
}

function loadJsByUrl(url,integrity=null) {
  const script = document.createElement("script");
  script.src = url;
  if(integrity){
    script.integrity=integrity;
    script.crossOrigin="anonymous"; //for some weird reason this attribute is case sensitive when used in JS
  }

  return new Promise((resolve) => {
    script.onload = resolve;
    document.documentElement.firstChild.appendChild(script);
  });
}
</script>
</head>
<body>

</body>
</html>`;

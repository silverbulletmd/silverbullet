import { useEffect, useRef } from "../deps.ts";
import { Editor } from "../editor.tsx";
import { PanelConfig } from "../types.ts";

export const panelHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <base target="_top">
<script>
window.addEventListener("message", (message) => {
  const data = message.data;
  switch (data.type) {
    case "html":
      document.body.innerHTML = data.html;
      if (data.script) {
        try {
          eval(data.script);
        } catch (e) {
          console.error("Error evaling script", e);
        }
      }
      break;
  }
});

function sendEvent(name, ...args) {
  window.parent.postMessage({ type: "event", name, args, }, "*");
}
function api(obj) {
  window.parent.postMessage(obj, "*");
}
function updateHeight() {
  api({
    type: "setHeight", 
    height: document.documentElement.offsetHeight,
  });
}

function loadJsByUrl(url) {
  const script = document.createElement("script");
  script.src = url;

  return new Promise((resolve) => {
    script.onload = resolve;
  
    document.documentElement.firstChild.appendChild(script);
  });
}
</script>
</head>
<body>
Send me HTML
</body>
</html>`;

export function Panel({
  config,
  editor,
}: {
  config: PanelConfig;
  editor: Editor;
}) {
  const iFrameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    function loadContent() {
      if (iFrameRef.current?.contentWindow) {
        iFrameRef.current.contentWindow.postMessage({
          type: "html",
          html: config.html,
          script: config.script,
        });
      }
    }
    if (!iFrameRef.current) {
      return;
    }
    const iframe = iFrameRef.current;
    iframe.onload = loadContent;
    loadContent();
    return () => {
      iframe.onload = null;
    };
  }, [config.html, config.script]);

  useEffect(() => {
    const messageListener = (evt: any) => {
      if (evt.source !== iFrameRef.current!.contentWindow) {
        return;
      }
      const data = evt.data;
      if (!data) {
        return;
      }
      if (data.type === "event") {
        editor.dispatchAppEvent(data.name, ...data.args);
      }
    };
    globalThis.addEventListener("message", messageListener);
    return () => {
      globalThis.removeEventListener("message", messageListener);
    };
  }, []);

  return (
    <div className="sb-panel" style={{ flex: config.mode }}>
      <iframe srcDoc={panelHtml} ref={iFrameRef} />
    </div>
  );
}

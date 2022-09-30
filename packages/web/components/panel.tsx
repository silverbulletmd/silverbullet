import { useEffect, useRef } from "react";
// @ts-ignore
import iframeHtml from "bundle-text:./panel.html";
import { Editor } from "../editor";
import { PanelConfig } from "../types";

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
    let iframe = iFrameRef.current;
    iframe.onload = loadContent;
    loadContent();
    return () => {
      iframe.onload = null;
    };
  }, [config.html, config.script]);

  useEffect(() => {
    let messageListener = (evt: any) => {
      if (evt.source !== iFrameRef.current!.contentWindow) {
        return;
      }
      let data = evt.data;
      if (!data) return;
      if (data.type === "event") {
        editor.dispatchAppEvent(data.name, ...data.args);
      }
    };
    window.addEventListener("message", messageListener);
    return () => {
      window.removeEventListener("message", messageListener);
    };
  }, []);

  return (
    <div className="sb-panel" style={{ flex: config.mode }}>
      <iframe srcDoc={iframeHtml} ref={iFrameRef} />
    </div>
  );
}

import { useEffect, useRef } from "https://esm.sh/preact@10.11.1/hooks";
import { Client } from "../client.ts";
import { PanelConfig } from "../../type/web.ts";
import { panelHtml } from "./panel_html.ts";

export function Panel({
  config,
  editor,
}: {
  config: PanelConfig;
  editor: Client;
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
      switch (data.type) {
        case "event":
          editor.dispatchAppEvent(data.name, ...data.args);
          break;
        case "syscall": {
          const { id, name, args } = data;
          editor.clientSystem.localSyscall(name, args).then(
            (result) => {
              if (!iFrameRef.current?.contentWindow) {
                // iFrame already went away
                return;
              }
              iFrameRef.current!.contentWindow!.postMessage({
                type: "syscall-response",
                id,
                result,
              });
            },
          ).catch((e: any) => {
            if (!iFrameRef.current?.contentWindow) {
              // iFrame already went away
              return;
            }
            iFrameRef.current!.contentWindow!.postMessage({
              type: "syscall-response",
              id,
              error: e.message,
            });
          });
          break;
        }
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

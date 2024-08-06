import { useEffect, useRef } from "preact/hooks";
import type { Client } from "../client.ts";
import type { PanelConfig } from "../type.ts";
import { panelHtml } from "./panel_html.ts";

export function Panel({
  config,
  editor,
}: {
  config: PanelConfig;
  editor: Client;
}) {
  const iFrameRef = useRef<HTMLIFrameElement>(null);

  function updateContent() {
    if (!iFrameRef.current?.contentWindow) {
      return;
    }

    iFrameRef.current.contentWindow.postMessage({
      type: "html",
      html: config.html,
      script: config.script,
      theme: document.getElementsByTagName("html")[0].dataset.theme,
    });
  }

  useEffect(() => {
    const iframe = iFrameRef.current;
    if (!iframe) {
      return;
    }

    iframe.addEventListener("load", updateContent);
    updateContent();

    return () => {
      iframe.removeEventListener("load", updateContent);
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
      <iframe
        srcDoc={panelHtml}
        ref={iFrameRef}
        style={{ visibility: "hidden" }}
        onLoad={() => iFrameRef.current!.style.visibility = "visible"}
      />
    </div>
  );
}

import { useEffect, useMemo, useRef } from "preact/hooks";
import type { Client } from "../client.ts";
import type { PanelConfig } from "../types/ui.ts";
import { panelHtml } from "./panel_html.ts";

export function Panel({
  config,
  editor,
}: {
  config: PanelConfig;
  editor: Client;
}) {
  switch (typeof config.html) {
    case "string":
      return <IFramePanel config={config} editor={editor} />;
    case "object":
      return <ShadowPanel config={config} />;
    default:
      return null;
  }
}

function IFramePanel({
  config,
  editor,
}: {
  config: PanelConfig;
  editor: Client;
}) {
  const iFrameRef = useRef<HTMLIFrameElement>(null);

  const html = useMemo(() => {
    return panelHtml.replace("{{.HostPrefix}}", document.baseURI);
  }, []);

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
        srcDoc={html}
        ref={iFrameRef}
        style={{ visibility: "hidden" }}
        onLoad={() => iFrameRef.current!.style.visibility = "visible"}
      />
    </div>
  );
}

function ShadowPanel({
  config,
}: {
  config: PanelConfig;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot>(null);
  function updateContent() {
    const shadow = shadowRef.current;
    if (!shadow) return;

    const root = shadow.getElementById("panel-root");
    if (!root) return;

    root.innerHTML = "";

    if (Array.isArray(config.html)) {
      root.append(...config.html);
    } else {
      root.append(config.html as HTMLElement);
    }
  }

  useEffect(() => {
    if (!panelRef.current) return;

    shadowRef.current = panelRef.current.attachShadow({ mode: "closed" });

    const container = document.createElement("div");
    container.id = "panel-root";
    shadowRef.current.appendChild(container);

    return () => {
      shadowRef.current = null;
    };
  }, []);

  useEffect(() => {
    updateContent();
  }, [config.html, config.script]);

  return (
    <div
      className="sb-panel"
      style={{ flex: config.mode }}
      ref={panelRef}
    />
  );
}

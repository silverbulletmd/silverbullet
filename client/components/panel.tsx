import { useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import type { Client } from "../client.ts";
import type { PanelConfig, PanelSlot } from "../types/ui.ts";
import { panelHtml } from "./panel_html.ts";

export function Panel({
  config,
  editor,
  slot,
}: {
  config: PanelConfig;
  editor: Client;
  slot: PanelSlot;
}) {
  switch (typeof config.html) {
    case "string":
      return <IFramePanel config={config} editor={editor} slot={slot} />;
    case "object":
      return <ShadowPanel config={config} />;
    default:
      return null;
  }
}

function IFramePanel({
  config,
  editor,
  slot,
}: {
  config: PanelConfig;
  editor: Client;
  slot: PanelSlot;
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

  // Declared (and flushed) before the content effect below on purpose: posting
  // `html` is what boots the panel's script, and the very first thing that
  // script does is issue syscalls. A syscall that arrives before this listener
  // exists is dropped, and the panel waits on a promise that never settles.
  useLayoutEffect(() => {
    const messageListener = (evt: any) => {
      if (evt.source !== iFrameRef.current?.contentWindow) {
        return;
      }
      const data = evt.data;
      if (!data) {
        return;
      }
      switch (data.type) {
        case "syscall": {
          const { id, name, args } = data;
          editor.clientSystem
            .localSyscall(name, args)
            .then((result) => {
              if (!iFrameRef.current?.contentWindow) {
                return;
              }
              iFrameRef.current!.contentWindow!.postMessage({
                type: "syscall-response",
                id,
                result,
              });
            })
            .catch((e: any) => {
              if (!iFrameRef.current?.contentWindow) {
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

  // A layout effect: a plain one is flushed *after* paint, so the panel would
  // already be on screen with nothing in it.
  useLayoutEffect(() => {
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

  // The theme only rides along with the `html` message, which a long-lived
  // panel receives once. Without this, toggling dark mode leaves every
  // persistent panel iframe on the theme it booted with.
  useEffect(() => {
    const observer = new MutationObserver(() => {
      iFrameRef.current?.contentWindow?.postMessage({
        type: "theme",
        theme: document.documentElement.dataset.theme,
      });
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <div className="sb-panel" style={{ flex: config.mode }}>
      <iframe
        srcDoc={html}
        ref={iFrameRef}
        data-slot={slot}
        style={{ visibility: "hidden" }}
        onLoad={() => (iFrameRef.current!.style.visibility = "visible")}
      />
    </div>
  );
}

function ShadowPanel({ config }: { config: PanelConfig }) {
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

    shadowRef.current = panelRef.current.attachShadow({ mode: "open" });

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
    <div className="sb-panel" style={{ flex: config.mode }} ref={panelRef} />
  );
}

import { useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";
import type { Client } from "../client.ts";
import { MOBILE_MEDIA_QUERY } from "../lib/mobile.ts";
import type { KeyedPanelConfig, PanelConfig, PanelSlot } from "../types/ui.ts";
import { panelHtml } from "./panel_html.ts";

export function Panel({
  config,
  editor,
  slot,
}: {
  config: PanelConfig | KeyedPanelConfig;
  editor: Client;
  /** A keyed config already carries this (`config.slot`); a legacy one
   * doesn't, so every caller passes it explicitly -- see the iframe's
   * `data-slot`, `editor.getFocusedPanelSlot`'s only reliable signal. */
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
  config: PanelConfig | KeyedPanelConfig;
  editor: Client;
  slot: PanelSlot;
}) {
  const iFrameRef = useRef<HTMLIFrameElement>(null);
  const wasHidden = useRef<boolean | undefined>(undefined);
  const initialShownSent = useRef(false);

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
      mobile: globalThis.matchMedia(MOBILE_MEDIA_QUERY).matches,
    });
  }

  function postInitialShownIfNeeded() {
    if (initialShownSent.current) {
      return;
    }
    initialShownSent.current = true;
    // Read the live wasHidden ref (kept current every render by the flip
    // effect below), not `config` — the `load` listener's closure captures
    // whatever `config` was current when the content-update effect last ran,
    // which can be stale by the time `load` actually fires.
    if (wasHidden.current === false) {
      iFrameRef.current?.contentWindow?.postMessage({ type: "panel:shown" });
    }
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
                // iFrame already went away
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

  // Layout effects for both of the messages below: a plain
  // effect is flushed *after* paint, so the panel would already be on screen —
  // and, for a keyed panel, already booted, focused and accepting keystrokes.
  useLayoutEffect(() => {
    const iframe = iFrameRef.current;
    if (!iframe) {
      return;
    }

    function onLoad() {
      updateContent();
      postInitialShownIfNeeded();
    }

    iframe.addEventListener("load", onLoad);
    updateContent();

    return () => {
      iframe.removeEventListener("load", onLoad);
    };
  }, [config.html, config.script]);

  useLayoutEffect(() => {
    const hidden = (config as KeyedPanelConfig).hidden;
    if (wasHidden.current !== undefined && wasHidden.current !== hidden) {
      iFrameRef.current?.contentWindow?.postMessage({
        type: hidden ? "panel:hidden" : "panel:shown",
      });
    }
    wasHidden.current = hidden;
  });

  // The theme only rides along with the `html` message, which a long-lived
  // (keyed/preloaded) panel receives once. Without this, toggling dark mode
  // leaves every persistent panel iframe on the theme it booted with.
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

  // Crossing the breakpoint mid-session (a rotation, a resized window) changes
  // how a docked panel is laid out, so it also changes how it should behave.
  // The boot value rides along with `html` above; this only carries changes.
  useEffect(() => {
    const mql = globalThis.matchMedia(MOBILE_MEDIA_QUERY);
    const onChange = (ev: MediaQueryListEvent) => {
      iFrameRef.current?.contentWindow?.postMessage({
        type: "panel:mobile",
        mobile: ev.matches,
      });
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const events = (config as KeyedPanelConfig).events;
    if (!events?.length) return;
    const listeners = events.map((name) => {
      const listener = (...args: any[]) => {
        iFrameRef.current?.contentWindow?.postMessage({
          type: "event",
          name,
          args,
        });
      };
      editor.eventHook.addLocalListener(name, listener);
      return { name, listener };
    });
    return () => {
      for (const { name, listener } of listeners) {
        editor.eventHook.removeLocalListener(name, listener);
      }
    };
  }, [(config as KeyedPanelConfig).events?.join(",")]);

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

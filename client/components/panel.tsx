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
  const panelRef = useRef<HTMLDivElement>(null);
  const shadowRef = useRef<ShadowRoot>(null);
  function updateContent() {
    const shadow = shadowRef.current;
    if (!shadow) return;

    const root = shadow.getElementById("panel-root");
    if (!root) return;

    root.innerHTML = "";

    root.setAttribute(
      "data-theme",
      document.documentElement.dataset.theme || "light",
    );
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

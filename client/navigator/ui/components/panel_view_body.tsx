import type {
  PanelViewContext,
  PanelViewDock,
  PanelViewResult,
} from "@silverbulletmd/silverbullet/type/manifest";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Client } from "../../../client.ts";
import { Panel } from "../../../components/panel.tsx";
import type { PanelConfig, PanelSlot } from "../../../types/ui.ts";
import { followsEditor } from "../../plug_views.ts";
import { panelView } from "../../registry.ts";
import type { NativeViewProps } from "../native_views.ts";

/**
 * The body of a plug's panel view: the sandboxed panel its function builds
 * for the showing tab and dock. Docked, a view that follows the editor is
 * built again for each page opened; in the modal it keeps the page it opened
 * on.
 */
export function PanelViewBody({
  client,
  view: name,
  slot,
  page,
  segmentIndex,
  focusTarget,
}: NativeViewProps) {
  // Gone for a moment when its plug unloads, until the navigator closes it
  const def = panelView(name)?.def;
  const tab = def?.tabs?.[segmentIndex]?.label;
  // Panel views only declare (and so only show in) these docks
  const dock = slot as PanelViewDock;
  const follows = dock !== "modal" && !!def && followsEditor(def, tab);
  const [panel, setPanel] = useState<
    { config: PanelConfig; id: number } | { error: string } | undefined
  >();
  const loads = useRef(0);
  const host = useRef<HTMLDivElement>(null);

  // A view that doesn't follow the editor isn't built again for a new page
  const builtFor = follows ? page : "";
  useEffect(() => {
    let cancelled = false;
    void buildPanel(client, name, { tab, page, dock }).then((result) => {
      if (cancelled) return;
      setPanel(
        "error" in result
          ? result
          : // A fresh id remounts the iframe: the old panel's listeners go with it
            {
              config: { html: result.html, script: result.script, mode: 1 },
              id: ++loads.current,
            },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [client, name, tab, builtFor, dock]);

  const id = panel && "id" in panel ? panel.id : undefined;
  useEffect(() => {
    const iframe = host.current?.querySelector("iframe");
    return iframe ? focusTarget(iframe) : undefined;
  }, [id, focusTarget]);

  return (
    <div
      className="sb-panel-view"
      data-modal-size={def?.modalSize ?? "default"}
      ref={host}
    >
      {panel === undefined ? null : "error" in panel ? (
        <div className="sb-panel-view-message">{panel.error}</div>
      ) : (
        <Panel
          key={panel.id}
          config={panel.config}
          editor={client}
          slot={dock as PanelSlot}
        />
      )}
    </div>
  );
}

async function buildPanel(
  client: Client,
  name: string,
  ctx: PanelViewContext,
): Promise<PanelViewResult> {
  const view = panelView(name);
  if (!view) return { error: `There is no view called ${name}.` };
  const plug = client.clientSystem.system.loadedPlugs.get(view.plug);
  if (!plug) return { error: `The ${view.plug} plug isn't loaded.` };
  try {
    const result = (await plug.invoke(view.fn, [ctx])) as PanelViewResult;
    if (!result || typeof result !== "object") {
      return { error: `${view.plug}.${view.fn} built no panel.` };
    }
    return result;
  } catch (e: any) {
    return { error: e?.message ?? String(e) };
  }
}

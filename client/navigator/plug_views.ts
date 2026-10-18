/**
 * Panel views: navigator views a plug declares in its manifest (`view:` on a
 * function), whose body is a sandboxed panel that function builds. The hook
 * (`plugos/hooks/panel_view.ts`) collects them; this is their meta and their
 * place in the registry.
 */
import type {
  PanelViewDef,
  PanelViewDock,
} from "@silverbulletmd/silverbullet/type/manifest";
import type { ViewMeta } from "./types.ts";
import { baseMeta } from "./views/types.ts";

const DOCKS: readonly PanelViewDock[] = ["modal", "lhs", "rhs", "bhs"];

/** A declared view, with the plug function that builds its panel */
export type PanelView = {
  def: PanelViewDef;
  plug: string;
  fn: string;
};

/** What's wrong with a `view:` declaration, if anything */
export function validatePanelView(def: unknown): string[] {
  if (!def || typeof def !== "object") {
    return ["view: must be an object with a name and a title"];
  }
  const d = def as Record<string, unknown>;
  const errors: string[] = [];
  if (typeof d.name !== "string" || !d.name) {
    errors.push("view: needs a name");
  }
  if (typeof d.title !== "string" || !d.title) {
    errors.push("view: needs a title");
  }
  if (d.dock !== undefined && !DOCKS.includes(d.dock as PanelViewDock)) {
    errors.push(`view: dock must be one of ${DOCKS.join(", ")}`);
  }
  if (
    d.supportedDocks !== undefined &&
    (!Array.isArray(d.supportedDocks) ||
      d.supportedDocks.some((x) => !DOCKS.includes(x)))
  ) {
    errors.push(
      `view: supportedDocks must list docks among ${DOCKS.join(", ")}`,
    );
  }
  if (
    d.tabs !== undefined &&
    (!Array.isArray(d.tabs) ||
      d.tabs.some((t) => !t || typeof t.label !== "string" || !t.label))
  ) {
    errors.push("view: tabs must be a list of { label } entries");
  }
  return errors;
}

export function panelViewMeta(def: PanelViewDef): ViewMeta {
  const dock = def.dock ?? "modal";
  return {
    ...baseMeta({
      title: def.title,
      noFilter: true,
      dock,
      supportedDocks: def.supportedDocks ?? [dock],
      hasRowIcon: false,
    }),
    name: def.name,
    segments: def.tabs?.map((tab, i) => ({
      label: tab.label,
      hasWhere: false,
      default: i === 0,
    })),
  } as ViewMeta;
}

/** Whether a docked view is built again when the editor opens another page */
export function followsEditor(def: PanelViewDef, tab?: string): boolean {
  const declared = def.tabs?.find((t) => t.label === tab);
  return declared?.followEditor ?? def.followEditor ?? false;
}

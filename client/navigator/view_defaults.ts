/**
 * The space's `view.defaults` table: per-view presentation defaults, sitting
 * between a client's own datastore override and the view's declared value.
 * Everything here is pure — resolution against a particular view's
 * `supportedDocks` happens in `dock_state.ts`, which is the only place that
 * knows what a given view supports.
 */

import { ALL_DOCKS } from "./types.ts";

const MIN_WIDTH = 160;
const MAX_WIDTH = 600;

export type ViewDefaults = {
  dock?: string;
  open?: boolean;
  collapsed?: boolean;
  width?: number;
};

export type ViewDefaultsTable = Record<string, ViewDefaults>;

function isTable(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeViewDefaults(raw: unknown): ViewDefaultsTable {
  if (!isTable(raw)) return {};
  const out: ViewDefaultsTable = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!isTable(value)) {
      console.warn(`view.defaults: ignoring "${name}", expected a table`);
      continue;
    }
    const entry: ViewDefaults = {};
    const { dock, open, collapsed, width } = value;
    if (dock !== undefined) {
      if (
        typeof dock === "string" &&
        (ALL_DOCKS as readonly string[]).includes(dock)
      ) {
        entry.dock = dock;
      } else {
        console.warn(`view.defaults: ignoring dock for "${name}": ${dock}`);
      }
    }
    if (open !== undefined) {
      if (typeof open === "boolean") entry.open = open;
      else console.warn(`view.defaults: ignoring open for "${name}"`);
    }
    if (collapsed !== undefined) {
      if (typeof collapsed === "boolean") entry.collapsed = collapsed;
      else console.warn(`view.defaults: ignoring collapsed for "${name}"`);
    }
    if (width !== undefined) {
      if (typeof width === "number" && Number.isFinite(width)) {
        entry.width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
      } else {
        console.warn(`view.defaults: ignoring width for "${name}"`);
      }
    }
    if (Object.keys(entry).length > 0) out[name] = entry;
  }
  return out;
}

/** Folds the pre-`view.defaults` dock tables in underneath, in the order given. */
export function mergeLegacyDocks(
  defaults: ViewDefaultsTable,
  ...legacy: unknown[]
): ViewDefaultsTable {
  const out: ViewDefaultsTable = { ...defaults };
  for (const table of legacy) {
    if (!isTable(table)) continue;
    for (const [name, dock] of Object.entries(table)) {
      if (typeof dock !== "string") continue;
      if (out[name]?.dock !== undefined) continue;
      out[name] = { ...out[name], dock };
    }
  }
  return out;
}

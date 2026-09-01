/**
 * Per-view dock/open/collapsed persistence. Three datastore keys per view —
 * `["navigator", <view>, "dock"]`, `["navigator", <view>, "open"]` and
 * `["navigator", <view>, "collapsed"]` — each resolved as datastore override >
 * space config (`view.defaults`) > the view's own declared value. A persisted
 * or configured value the view no longer supports falls through to the next
 * level rather than erroring (see spec §7).
 */

import type { ViewDefaults } from "./view_defaults.ts";

const NAMESPACE = "navigator";

export type DockMeta = {
  dock: string;
  supportedDocks?: string[];
  defaultOpen?: boolean;
};

export type DockStateDeps = {
  store: {
    get(key: unknown[]): Promise<unknown>;
    set(key: unknown[], value: unknown): Promise<void>;
    del(key: unknown[]): Promise<void>;
  };
  spaceDefaults(name: string): ViewDefaults | undefined;
};

export function createDockState(deps: DockStateDeps) {
  const dockKey = (name: string) => [NAMESPACE, name, "dock"];
  const openKey = (name: string) => [NAMESPACE, name, "open"];
  const collapsedKey = (name: string) => [NAMESPACE, name, "collapsed"];

  function supported(meta: DockMeta, dock: unknown): dock is string {
    if (typeof dock !== "string") return false;
    const docks = meta.supportedDocks ?? [meta.dock];
    return docks.includes(dock);
  }

  function configured(name: string): ViewDefaults {
    return deps.spaceDefaults(name) ?? {};
  }

  async function resolveDock(name: string, meta: DockMeta): Promise<string> {
    const saved = await deps.store.get(dockKey(name));
    if (supported(meta, saved)) return saved;
    const configuredDock = configured(name).dock;
    if (supported(meta, configuredDock)) return configuredDock;
    return meta.dock;
  }

  async function setDock(name: string, dock: string): Promise<void> {
    await deps.store.set(dockKey(name), dock);
  }

  async function isOpen(name: string, meta: DockMeta): Promise<boolean> {
    const saved = await deps.store.get(openKey(name));
    if (typeof saved === "boolean") return saved;
    const open = configured(name).open;
    if (typeof open === "boolean") return open;
    return meta.defaultOpen === true;
  }

  async function setOpen(name: string, open: boolean): Promise<void> {
    await deps.store.set(openKey(name), open);
  }

  /**
   * Whether a sidebar view opens at boot. Deliberately blind to
   * `meta.defaultOpen`, which has always been page-dock-only: a view
   * declaring it alongside `dock = "lhs"` must not start auto-opening now that
   * sidebars have a default-open level at all.
   */
  async function sidebarDefaultOpen(name: string): Promise<boolean> {
    const saved = await deps.store.get(openKey(name));
    if (typeof saved === "boolean") return saved;
    return configured(name).open === true;
  }

  /**
   * Whether a page-docked view is rolled up to its title bar. Independent of
   * `open`: a collapsed view is still open, it just isn't showing its body.
   */
  async function isCollapsed(name: string): Promise<boolean> {
    const saved = await deps.store.get(collapsedKey(name));
    if (typeof saved === "boolean") return saved;
    return configured(name).collapsed === true;
  }

  async function setCollapsed(name: string, collapsed: boolean): Promise<void> {
    await deps.store.set(collapsedKey(name), collapsed);
  }

  return {
    resolveDock,
    setDock,
    isOpen,
    setOpen,
    sidebarDefaultOpen,
    isCollapsed,
    setCollapsed,
  };
}

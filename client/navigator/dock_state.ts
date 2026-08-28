/**
 * Per-view dock/open/collapsed persistence. Three datastore keys per view —
 * `["navigator", <view>, "dock"]`, `["navigator", <view>, "open"]` and
 * `["navigator", <view>, "collapsed"]` — with resolution precedence for the
 * dock: datastore override > space config default (`navigator.docks`) > the
 * view's own declared dock. A persisted value the view no longer supports
 * falls through to the next level rather than erroring (see spec §7).
 */

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
  spaceDefault(name: string): string | undefined;
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

  async function resolveDock(name: string, meta: DockMeta): Promise<string> {
    const saved = await deps.store.get(dockKey(name));
    if (supported(meta, saved)) return saved;
    const configured = deps.spaceDefault(name);
    if (supported(meta, configured)) return configured;
    return meta.dock;
  }

  async function setDock(name: string, dock: string): Promise<void> {
    await deps.store.set(dockKey(name), dock);
  }

  async function isOpen(name: string, meta: DockMeta): Promise<boolean> {
    const saved = await deps.store.get(openKey(name));
    if (typeof saved === "boolean") return saved;
    return meta.defaultOpen === true;
  }

  async function setOpen(name: string, open: boolean): Promise<void> {
    await deps.store.set(openKey(name), open);
  }

  /**
   * Whether a page-docked view is rolled up to its title bar. Independent of
   * `open`: a collapsed view is still open, it just isn't showing its body.
   * Anything but a stored `true` is expanded, so a key that was never written
   * (or holds junk) reads as the default.
   */
  async function isCollapsed(name: string): Promise<boolean> {
    return (await deps.store.get(collapsedKey(name))) === true;
  }

  async function setCollapsed(name: string, collapsed: boolean): Promise<void> {
    await deps.store.set(collapsedKey(name), collapsed);
  }

  return {
    resolveDock,
    setDock,
    isOpen,
    setOpen,
    isCollapsed,
    setCollapsed,
  };
}

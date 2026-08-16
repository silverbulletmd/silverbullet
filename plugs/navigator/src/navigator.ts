import { asset } from "@silverbulletmd/silverbullet/syscalls";
import { panelStyles } from "@silverbulletmd/silverbullet/lib/panel_styles";
import { createPanelLifecycle } from "@silverbulletmd/silverbullet/lib/panel_lifecycle";
import {
  openOnStartViews,
  register,
  resolveMeta,
  selectInFlight,
  unregister,
} from "./registry.ts";

const PLUG_NAME = "navigator";
const MODAL_MODE = 100;
const MIN_WIDTH = 160;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 260;

let assetBundle: Promise<{ css: string; js: string }> | undefined;

function assets(): Promise<{ css: string; js: string }> {
  if (!assetBundle) {
    const pending = Promise.all([
      asset.readAsset(PLUG_NAME, "assets/navigator.css"),
      asset.readAsset(PLUG_NAME, "assets/navigator.js"),
    ]).then(([css, js]) => ({ css, js }));
    // Drop a rejected read from the memo, guarded on identity so a retry already in flight wins.
    void pending.catch(() => {
      if (assetBundle === pending) assetBundle = undefined;
    });
    assetBundle = pending;
  }
  return assetBundle;
}

function buildEvents(refreshOn: string[] | undefined): string[] {
  return [
    ...new Set([
      ...(refreshOn ?? []),
      "editor:pageLoaded",
      "editor:pageReloaded",
      "navigator:activate",
    ]),
  ];
}

export function viewMeta(name: string): any | undefined {
  return resolveMeta(name);
}

export type OpenOptions = {
  segment?: string;
  phrase?: string;
  quiet?: boolean;
};

// Keyed by the view's __pick: name, not slot, so a settle can never race a same-slot reassignment.
const pendingPicks = new Map<string, (value: unknown) => void>();

function settlePick(name: string, value: unknown) {
  const resolve = pendingPicks.get(name);
  if (!resolve) return;
  pendingPicks.delete(name);
  unregister(name);
  resolve(value);
}

// Waits for an in-flight select before nulling the pick, so the bridge answer isn't raced out from under it.
function supersede(name: string) {
  const inFlight = selectInFlight(name);
  if (inFlight) void inFlight.finally(() => settlePick(name, null));
  else settlePick(name, null);
}

const lifecycle = createPanelLifecycle({
  namespace: PLUG_NAME,
  widthBounds: { min: MIN_WIDTH, max: MAX_WIDTH, default: DEFAULT_WIDTH },
  modalMode: MODAL_MODE,
  notFoundLabel: "navigator view",
  getMeta: viewMeta,
  buildEvents,
  content: {
    preamble: () => panelStyles(),
    build: async (slot, preamble) => {
      const { css, js } = await assets();
      return {
        html: `${preamble}<style>${css}</style><div id="navigator-root" tabindex="-1"></div>`,
        script: `var __NAVIGATOR_SLOT = ${JSON.stringify(slot)};\n${js}`,
      };
    },
  },
  getForcedOpens: openOnStartViews,
  onSuperseded: supersede,
  onSlotClosedWithoutSuccessor: (view) => settlePick(view, null),
});

export function ready(data: { slot: string }) {
  return lifecycle.ready(data);
}

export function open(name: string, opts?: OpenOptions): Promise<boolean> {
  return lifecycle.open(name, {
    quiet: opts?.quiet,
    phrase: opts?.phrase,
    segment: opts?.segment,
  });
}

function openCommand(name: string) {
  return async (): Promise<boolean | undefined> => {
    if (await open(name)) return false;
  };
}

export const openToc = openCommand("std.toc");
export const openTocModal = openCommand("std.tocModal");
export const openSpaceTree = openCommand("std.spaceTree");

export function pickOpen(name: string, meta: any): Promise<unknown> {
  // settlePick before register, so this call's belt-and-suspenders settle can't unregister the meta it's about to register.
  settlePick(name, null);
  register({ meta });
  return new Promise((resolve) => {
    pendingPicks.set(name, resolve);
    open(name)
      .then((opened) => {
        // Nothing else settles this pick if the view fails to open at all.
        if (!opened) settlePick(name, null);
      })
      .catch(() => settlePick(name, null));
  });
}

export function pickSettle(name: string, obj: unknown) {
  settlePick(name, obj ?? null);
}

export function panelHidden(data: {
  slot: string;
  view?: string;
  token?: number;
}): Promise<void> {
  return lifecycle.panelHidden(data);
}

export async function route(data: {
  slot: string;
  view: string;
  phrase?: string;
  from?: string;
}): Promise<void> {
  const { slot, view: name } = data;
  // Rejects a view routing to itself so Backspace doesn't step back to itself.
  if (name === data.from) return;
  await lifecycle.replaceInSlot(slot, name, {
    phrase: data.phrase ?? "",
    from: data.from,
  });
}

export function resize(data: {
  slot: string;
  width: number;
  commit?: boolean;
  // Authoritative right after a route() hop, whose target isn't persisted, so the datastore alone would recover the pre-hop view instead.
  view?: string;
}): Promise<void> {
  return lifecycle.resize(data);
}

export async function preload() {
  await lifecycle.preloadModal();
  await lifecycle.restoreDocks();
}

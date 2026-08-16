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
    // Drop a rejected read from the memo: caching it would leave the
    // navigator permanently broken for the session after one transient
    // failure. Guarded on identity so a retry already in flight wins.
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
      // Not a refresh trigger -- the panel only re-derives read-only state
      // from it (see ui/index.tsx).
      "editor:pageReloaded",
      "navigator:activate",
    ]),
  ];
}

/** A view's metadata, from whichever half of the registry has it. */
export function viewMeta(name: string): any | undefined {
  return resolveMeta(name);
}

/** What `navigator.open` accepts beyond the view name. */
export type OpenOptions = {
  segment?: string;
  phrase?: string;
  /**
   * Report an unknown view by returning false rather than by flashing an
   * error. For a caller that has somewhere else to go -- the "Journal:
   * Picker" and "Page: From Template" commands fall back to
   * `editor.filterBox` when their Lua-defined view hasn't been indexed yet --
   * the error would be about a decision the user never made.
   */
  quiet?: boolean;
};

// View name -> the resolver of a `navigator.pick(...)` call still awaiting its
// outcome. Modal-only in practice (a pick always registers `dock = "modal"`),
// keyed by the view's reserved `__pick:` name rather than by slot so a settle
// can never race a same-slot reassignment. Settled with the picked object by
// `pickSettle` (the ephemeral view's own `onSelect` wrapper, Lua-side); with
// `null` by whichever of the lifecycle's hooks below notices the pick lost
// the slot without one -- superseded by a newer open, or closed outright.
const pendingPicks = new Map<string, (value: unknown) => void>();

function settlePick(name: string, value: unknown) {
  const resolve = pendingPicks.get(name);
  if (!resolve) return;
  pendingPicks.delete(name);
  // Only ever a `__pick:` name; done with its one-shot registration too.
  unregister(name);
  resolve(value);
}

/**
 * The lifecycle's "a new activation takes the slot from whatever was
 * pending" hook. A plain `settlePick(name, null)` would race a `select`
 * already crossing the bridge for the same view (a row the user just
 * clicked): the bridge call has to reach `pickSettle` before this can
 * safely null it out from under that answer, so wait for it first when one
 * is in flight -- `settlePick` is already a no-op once `pickSettle` won.
 */
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
        // var so it hoists into the eval'd scope (same trick as object-graph)
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

/** True once a panel is up and owns focus. */
export function open(name: string, opts?: OpenOptions): Promise<boolean> {
  return lifecycle.open(name, {
    quiet: opts?.quiet,
    phrase: opts?.phrase,
    segment: opts?.segment,
  });
}

/**
 * A `Navigator: …` command's whole body, for a built-in view that (unlike a
 * Lua one) has no `navigator.define` to register this wrapper for it: opens
 * the view, and returns `false` once it has -- same as the Lua wrapper's `if
 * navigator.open(spec.name) then return false end`, so the panel keeps focus
 * rather than losing it back to the editor.
 */
function openCommand(name: string) {
  return async (): Promise<boolean | undefined> => {
    if (await open(name)) return false;
  };
}

export const openToc = openCommand("std.toc");
export const openTocModal = openCommand("std.tocModal");
export const openSpaceTree = openCommand("std.spaceTree");

/**
 * Registers `name` -- an ephemeral `__pick:` view -- and opens it, resolving
 * once the pick's outcome is known rather than as soon as the panel is up
 * (unlike `open`). Resolves to the picked object, or `null` for a dismissal
 * or for being superseded before anything was picked. See `pickSettle` (the
 * "picked" case) and `supersede`/`onSlotClosedWithoutSuccessor` above (the
 * other two).
 *
 * `meta` rides along as this call's own payload rather than a separate
 * `navigator.register` round trip ahead of it: `navigator.pick`'s Lua
 * wrapper already validated and serialized it, and a `__pick:` name can
 * never collide with a built-in.
 */
export function pickOpen(name: string, meta: any): Promise<unknown> {
  // Belt-and-suspenders against a name collision (the Lua side salts its
  // reserved names to make this practically impossible, but a `Map.set`
  // silently dropping whatever was already waiting under `name` would be a
  // permanently-suspended pick with no error and nothing in the UI to say
  // why -- so it's settled, not just overwritten, on the off chance). Ahead
  // of `register`, so that belt-and-suspenders settle can never unregister
  // the meta this call is about to register.
  settlePick(name, null);
  register({ meta });
  return new Promise((resolve) => {
    pendingPicks.set(name, resolve);
    open(name)
      .then((opened) => {
        // The view failed to open at all (a definition-time race, essentially
        // never in practice) -- nothing will ever settle this otherwise.
        if (!opened) settlePick(name, null);
      })
      .catch(() => settlePick(name, null));
  });
}

/** Resolves a pending `navigator.pick` with the row that was picked. */
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

/**
 * Prefix routing (`prefixViews`): swap the view a slot is showing for a
 * sibling, in place. Unlike `open`, the target's own `dock` is ignored -- the
 * whole point is that it takes over the slot the user is already looking at,
 * at the width that slot already has.
 *
 * Deliberately not remembered as the slot's docked view: a hop is a detour
 * inside a session, and the next boot should bring back the sidebar the user
 * actually left open, not the one they last hopped to.
 */
export async function route(data: {
  slot: string;
  view: string;
  phrase?: string;
  from?: string;
}): Promise<void> {
  const { slot, view: name } = data;
  // A view routing to itself would replace the panel with the panel and hand
  // it a `from` pointing at itself, so Backspace would "step back" nowhere.
  // Cheap to reject here; `navigator.define` can't, since the target is only
  // ever resolved by name.
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
  /**
   * The view this drag's panel is showing, as tracked live by the panel
   * itself (`nav_root.tsx`'s `view` state). Authoritative even right after a
   * `route()` hop, whose target is deliberately not persisted to the
   * datastore (see `route`) -- so re-deriving from the datastore alone would
   * recover the pre-hop view instead. Only consulted to recover a wiped
   * tracked-view; a payload without it (an older bundle mid-reload) falls
   * back to the datastore, which is right everywhere except immediately
   * after a hop.
   */
  view?: string;
}): Promise<void> {
  return lifecycle.resize(data);
}

export async function preload() {
  // Mount the modal panel hidden so first open is instant; sidebars preload
  // lazily on first open (they're usually toggled once per session).
  await lifecycle.preloadModal();
  await lifecycle.restoreDocks();
}

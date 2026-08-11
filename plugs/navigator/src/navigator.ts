import {
  asset,
  datastore,
  editor,
  events,
} from "@silverbulletmd/silverbullet/syscalls";
import { panelStyles } from "@silverbulletmd/silverbullet/ui";
import { builtinMeta } from "./builtins.ts";

const PLUG_NAME = "navigator";
const MODAL_MODE = 100;
const MIN_WIDTH = 160;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 260;

function clampWidth(width: number): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

function widthMode(width: number): string {
  return `0 0 ${clampWidth(width)}px`;
}

type PanelContent = { html: string; script: string };

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

// Cached per slot and keyed by the space-style preamble. The identity of the
// html/script strings is what lets the host's `show-keyed-panel` reducer
// recognize a same-content re-show and skip rebuilding the iframe, so a plain
// per-slot memo is required -- but memoizing the *preamble* too would pin
// whatever space styles happened to be loaded at `preload` time. They usually
// aren't any: the client fires `loadCustomStyles()` un-awaited right before
// `editor:init`, which is what triggers preload. Re-reading them per build and
// only rebuilding when they actually changed keeps both properties, and a
// change produces new html -- the guarded re-eval path in ui/index.tsx makes
// that safe.
const panelContentCache = new Map<
  string,
  { preamble: string; content: PanelContent }
>();

async function panelContent(slot: string): Promise<PanelContent> {
  const preamble = await panelStyles();
  const cached = panelContentCache.get(slot);
  if (cached && cached.preamble === preamble) return cached.content;
  const { css, js } = await assets();
  const content: PanelContent = {
    html: `${preamble}<style>${css}</style><div id="navigator-root" tabindex="-1"></div>`,
    // var so it hoists into the eval'd scope (same trick as object-graph)
    script: `var __NAVIGATOR_SLOT = ${JSON.stringify(slot)};\n${js}`,
  };
  panelContentCache.set(slot, { preamble, content });
  return content;
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

/**
 * A view's metadata, from whichever registry has it. Space Lua is asked
 * first, so a space redefining `std.pages` replaces the built-in; the plug's
 * own registry answers for the rest -- which, before the space has ever been
 * indexed, is every built-in there is (see `builtins.ts`).
 */
export async function viewMeta(name: string): Promise<any | undefined> {
  const [fromLua] = await events.dispatchEvent("navigator:meta", { name });
  return fromLua ?? builtinMeta(name);
}

async function eventsForView(name: string): Promise<string[]> {
  const meta = await viewMeta(name);
  return buildEvents(meta?.refreshOn);
}

// Which view each slot was last asked to show, and the token identifying that
// `open()` call. The iframe pulls this on boot (`navigator:ready`) because the
// `navigator:activate` push below is dropped when the panel hasn't finished
// mounting yet -- so a single `open()` can reach the panel twice, and the
// token is how it tells a duplicate from a genuine re-invocation.
const pendingActivation = new Map<string, Activation>();
let activationToken = 0;

type Activation = {
  view: string;
  token: number;
  passive?: boolean;
  /** The phrase the target view opens with (prefix routing, or `open` opts). */
  phrase?: string;
  /** Prefix routing: the view a Backspace on an empty phrase returns to. */
  from?: string;
  /** Label of the segment to activate, overriding the remembered one. */
  segment?: string;
};

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

/** Slot -> the view remembered as docked there, restored on the next boot. */
function dockedKey(slot: string) {
  return ["navigator", "docked", slot];
}

const SIDEBAR_SLOTS = ["lhs", "rhs"];

// Slot -> view name currently visible (not hidden) in a sidebar dock (lhs or
// rhs). Only `resize` reads it: a drag tick that lands after the panel closed
// (or switched views) must not re-show it. Cleared by the `panelHidden` echo.
const visibleSidebarView = new Map<string, string>();

// Slots with a real close in flight: `panelHidden` has cleared
// `visibleSidebarView` for the slot but its `datastore.del` hasn't resolved
// yet. `resize`'s datastore-fallback path checks this before trusting a
// re-derived name, so a drag tick landing in that window can't read the
// not-yet-deleted key and re-show (and re-arm) a panel that's actually
// closing.
const closingSlots = new Set<string>();

// Slot -> events forwarded to the panel the last time it was shown, reused by
// `resize` so its re-`showPanel` call (same key, same html/script) doesn't
// drop any event subscriptions.
const slotEvents = new Map<string, string[]>();

// Slot -> the flex mode it is currently shown with, so a prefix-routed view
// takes over the slot at exactly the width it already had rather than at
// whatever width happens to be saved under its own name.
const slotMode = new Map<string, number | string>();

export function ready(data: { slot: string }): Activation | undefined {
  return pendingActivation.get(data.slot);
}

// View name -> the resolver of a `navigator.pick(...)` call still awaiting its
// outcome. Modal-only in practice (a pick always registers `dock = "modal"`),
// keyed by the view's reserved `__pick:` name rather than by slot so a settle
// can never race a same-slot reassignment. Settled with the picked object by
// `pickSettle` (the ephemeral view's own `onSelect` wrapper, Lua-side); with
// `null` by whichever of `show`/`route`/`panelHidden` below notices the pick
// lost the slot without one -- superseded by a newer open, or closed outright.
const pendingPicks = new Map<string, (value: unknown) => void>();

function settlePick(name: string, value: unknown) {
  const resolve = pendingPicks.get(name);
  if (!resolve) return;
  pendingPicks.delete(name);
  resolve(value);
}

export async function panelHidden(
  data: { slot: string; view?: string; token?: number },
) {
  visibleSidebarView.delete(data.slot);
  // A real close, with no successor activation for the slot: whatever pick
  // was showing (Escape, backdrop, a create row -- anything short of picking
  // a row) resolves nil. A no-op for every other view, and for a pick that
  // already settled via `pickSettle` (select deletes it from the map first).
  //
  // The close has to be matched against the slot's *current* activation by
  // token before it's allowed to settle anything: a sequential pick (`local
  // a = navigator.pick{...}; local b = navigator.pick{...}`) can have A's
  // `pickSettle` resolve A and close its panel, then B open and take the
  // slot in `pendingActivation`, and only *then* have A's own `panel:hidden`
  // notification finish its round trip through the client back to this
  // worker -- the client/worker/iframe hops involved (React commit,
  // postMessage, the worker boundary) give no ordering guarantee between
  // that notification and B's own activation. Without the token check, this
  // stale close would read `pendingActivation` as B and settle B with `nil`
  // before the user ever got to act on it -- the panel would then also be
  // left hidden, since the close that arrived was for A's activation, not
  // B's. Comparing against the token (stamped on the activation by `show`/
  // `route`, carried back by the iframe on the close it actually saw) is
  // what tells a stale close from the one the current occupant is owed.
  const pending = pendingActivation.get(data.slot);
  if (pending && data.token !== undefined && pending.token === data.token) {
    settlePick(pending.view, null);
  }
  // Closing a dock is what un-remembers it: the next boot restores whatever
  // was still open when this client last ran.
  if (SIDEBAR_SLOTS.includes(data.slot)) {
    // Marked in the same synchronous tick as the map delete above (no await
    // between them), so any `resize` that reads the map as empty always sees
    // this too -- see `closingSlots`.
    closingSlots.add(data.slot);
    try {
      await datastore.del(dockedKey(data.slot));
    } finally {
      closingSlots.delete(data.slot);
    }
  }
}

/** True once a panel is up and owns focus. */
export function open(name: string, opts?: OpenOptions): Promise<boolean> {
  return show(name, false, opts);
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
 * Opens `name` -- an ephemeral view `navigator.pick`'s Lua wrapper has just
 * registered under its reserved `__pick:` name -- and resolves once the
 * pick's outcome is known, rather than as soon as the panel is up (unlike
 * `open`). Resolves to the picked object, or `null` for a dismissal or for
 * being superseded before anything was picked. See `pickSettle` (the
 * "picked" case) and `panelHidden`/`show`/`route` above (the other two).
 */
export function pickOpen(name: string): Promise<unknown> {
  // Belt-and-suspenders against a name collision (the Lua side salts its
  // reserved names to make this practically impossible, but a `Map.set`
  // silently dropping whatever was already waiting under `name` would be a
  // permanently-suspended pick with no error and nothing in the UI to say
  // why -- so it's settled, not just overwritten, on the off chance).
  settlePick(name, null);
  return new Promise((resolve) => {
    pendingPicks.set(name, resolve);
    show(name, false).then((opened) => {
      // The view failed to open at all (a definition-time race, essentially
      // never in practice) -- nothing will ever settle this otherwise.
      if (!opened) settlePick(name, null);
    }).catch(() => settlePick(name, null));
  });
}

/** Resolves a pending `navigator.pick` with the row that was picked. */
export function pickSettle(name: string, obj: unknown) {
  settlePick(name, obj ?? null);
}

/**
 * @param passive a boot restore rather than a user asking for the view: the
 * panel comes back where it was, but must not take focus or move its tree.
 */
async function show(
  name: string,
  passive: boolean,
  opts?: OpenOptions,
): Promise<boolean> {
  const meta = await viewMeta(name);
  if (!meta) {
    if (!opts?.quiet) {
      await editor.flashNotification(
        `No navigator view named ${name}`,
        "error",
      );
    }
    return false;
  }
  const slot = meta.dock;

  // Toggle-on-focused: closed -> open+focus and visible-but-unfocused ->
  // re-focus are both the fall-through below (`showPanel` no-ops on an
  // already-shown key; the `navigator:activate` re-dispatch is what makes an
  // unfocused dock take focus). Focused -> hide is the one case that isn't a
  // re-open at all, so it's handled here, ahead of any of that -- the same
  // dock-opening command, pressed again while its own dock already has
  // focus, reads as "close it". Modal is exempt: a picker already resets
  // and re-focuses on every open by design, and has its own dismissal
  // (Escape, backdrop, a pick) rather than a re-press-to-close gesture.
  if (
    !passive &&
    slot !== "modal" &&
    visibleSidebarView.get(slot) === name &&
    (await editor.getFocusedPanelSlot()) === slot
  ) {
    await editor.hidePanel(slot);
    await editor.focus();
    return true;
  }

  // Last-open-wins: this activation takes the slot from whatever was
  // pending for it, including a `navigator.pick` still awaiting its outcome
  // -- which is exactly what "superseded" resolves to nil.
  const previous = pendingActivation.get(slot);
  if (previous && previous.view !== name) settlePick(previous.view, null);

  const token = ++activationToken;
  const activation: Activation = {
    view: name,
    token,
    passive,
    // Only when asked for: `undefined` is what tells the panel "leave the
    // phrase/segment alone", which is what every ordinary open wants.
    phrase: opts?.phrase,
    segment: opts?.segment,
  };
  pendingActivation.set(slot, activation);
  const { html, script } = await panelContent(slot);
  let mode: number | string = MODAL_MODE;
  if (slot !== "modal") {
    const saved = await datastore.get(["navigator", name, "width"]);
    mode = widthMode(typeof saved === "number" ? saved : DEFAULT_WIDTH);
  }
  const panelEvents = buildEvents(meta.refreshOn);
  slotEvents.set(slot, panelEvents);
  slotMode.set(slot, mode);
  await editor.showPanel(slot as any, mode, html, script, {
    key: `navigator:${slot}`,
    events: panelEvents,
    // The panel's own `close()` (commands.ts) hands this same token back to
    // `editor.hidePanel` when it closes, so a close decided on this
    // activation can never hide whatever a later one replaces it with --
    // see the pick round's task-pick-api-review.md, Critical 1.
    activationId: token,
  });
  if (slot !== "modal") {
    visibleSidebarView.set(slot, name);
    await datastore.set(dockedKey(slot), name);
  }
  // Tell the (possibly already-mounted) iframe which view to display. Re-run
  // on a dock that's already showing this view: `showPanel` above is a no-op
  // (same key, same html/script identity) and this re-signal is what makes the
  // panel re-focus its filter input rather than toggle closed.
  await events.dispatchEvent("navigator:activate", { slot, ...activation });
  return true;
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
}) {
  const { slot, view: name } = data;
  // A view routing to itself would replace the panel with the panel and hand
  // it a `from` pointing at itself, so Backspace would "step back" nowhere.
  // Cheap to reject here; `navigator.define` can't, since the target is only
  // ever resolved by name.
  if (name === data.from) return;
  const meta = await viewMeta(name);
  if (!meta) {
    await editor.flashNotification(`No navigator view named ${name}`, "error");
    return;
  }
  // See `show`: a prefix hop takes the slot too, and a pick doesn't define
  // `prefixViews` to route *out* through, but nothing stops another view's
  // hop from landing on a pick's reserved name -- so the same guard applies.
  const previous = pendingActivation.get(slot);
  if (previous && previous.view !== name) settlePick(previous.view, null);
  const token = ++activationToken;
  const activation: Activation = {
    view: name,
    token,
    phrase: data.phrase ?? "",
    from: data.from,
  };
  pendingActivation.set(slot, activation);
  // The target's refresh triggers, since it is the view whose rows are about
  // to be on screen. Only the forwarded-event subscriptions change; the html
  // and script are identical, so the panel is not rebuilt (and the user's
  // half-typed phrase survives).
  const panelEvents = buildEvents(meta.refreshOn);
  slotEvents.set(slot, panelEvents);
  const { html, script } = await panelContent(slot);
  await editor.showPanel(
    slot as any,
    slotMode.get(slot) ??
      (slot === "modal" ? MODAL_MODE : widthMode(DEFAULT_WIDTH)),
    html,
    script,
    { key: `navigator:${slot}`, events: panelEvents, activationId: token },
  );
  if (slot !== "modal") visibleSidebarView.set(slot, name);
  await events.dispatchEvent("navigator:activate", { slot, ...activation });
}

export async function resize(data: {
  slot: string;
  width: number;
  commit?: boolean;
  /**
   * The view this drag's panel is showing, as tracked live by the panel
   * itself (`nav_root.tsx`'s `view` state). Authoritative even right after a
   * `route()` hop, whose target is deliberately not persisted to the
   * datastore (see `route`) -- so re-deriving from the datastore alone would
   * recover the pre-hop view instead. Only consulted to recover a wiped
   * `visibleSidebarView`; a payload without it (an older bundle mid-reload)
   * falls back to the datastore, which is right everywhere except
   * immediately after a hop.
   */
  view?: string;
}) {
  let name = visibleSidebarView.get(data.slot);
  if (!name) {
    // Not necessarily a stray event: this is module-level plug-worker state,
    // and the panel iframe it describes lives on the host side -- anything
    // that recycles the plug worker without also rebuilding the panel (e.g.
    // the server-side runtime restarting its sandbox, or the `Plugs: Reload`
    // command, which unloads and re-instantiates every plug in place) wipes
    // this map while the dock stays visibly open. Bail immediately if a real
    // close is already in flight (see `panelHidden`/`closingSlots`) rather
    // than pay for a re-derivation that would only be discarded.
    if (closingSlots.has(data.slot)) return;
    let candidate = typeof data.view === "string" && data.view
      ? data.view
      : undefined;
    if (!candidate) {
      const saved = await datastore.get(dockedKey(data.slot));
      candidate = typeof saved === "string" ? saved : undefined;
    }
    if (!candidate) return; // genuinely no dock in this slot
    // Confirm this actually names a live view before trusting it into
    // `visibleSidebarView` and, below, into the width datastore key -- a
    // payload can't be blindly trusted. This also fetches `refreshOn`,
    // needed to re-seed `slotEvents` below (a drag tick must not dispatch
    // `navigator:meta` on every rAF frame to find that out itself -- see
    // `eventsForView`). One syscall, paid only on this first post-wipe tick;
    // every later tick hits the cheap map/slotEvents lookups like before.
    const meta = await viewMeta(candidate);
    if (!meta) return;
    // A real show()/route() call, or a real close, may have landed while the
    // awaits above were in flight; prefer that fresher truth over the
    // derivation this tick was about to commit.
    const fresh = visibleSidebarView.get(data.slot);
    if (fresh) {
      name = fresh;
    } else {
      if (closingSlots.has(data.slot)) return;
      name = candidate;
      visibleSidebarView.set(data.slot, name);
      slotEvents.set(data.slot, buildEvents(meta.refreshOn));
    }
  }
  const width = clampWidth(data.width);
  if (data.commit) {
    await datastore.set(["navigator", name, "width"], width);
  }
  // The already-built content, deliberately: a drag tick must not re-read the
  // space styles (a syscall per rAF frame), and swapping the html mid-drag
  // would rebuild the iframe under the user's pointer.
  const built = panelContentCache.get(data.slot);
  const { html, script } = built
    ? built.content
    : await panelContent(data.slot);
  // The panel may have been closed (or switched to a different view) by the
  // time the awaits above settle; re-showing it now would incorrectly reopen
  // it, or apply this drag's width to the wrong view.
  if (visibleSidebarView.get(data.slot) !== name) return;
  const panelEvents = slotEvents.get(data.slot) ?? (await eventsForView(name));
  slotMode.set(data.slot, widthMode(width));
  // No `activationId` here, deliberately: this slot's own `pendingActivation`
  // token can be stale relative to what this iframe's own `handledToken`
  // still has (e.g. right after a plug reload, which resets the former but
  // never touches the latter) -- passing it would risk *replacing* a still-
  // correct activationId with a wrong one. Omitting the field leaves the
  // reducer's own `show-keyed-panel` case to preserve whatever was already
  // there, which is what a drag-resize re-show -- the same activation the
  // whole time -- actually wants.
  await editor.showPanel(data.slot as any, widthMode(width), html, script, {
    key: `navigator:${data.slot}`,
    events: panelEvents,
  });
}

export async function preload() {
  // Mount the modal panel hidden so first open is instant; sidebars preload
  // lazily on first open (they're usually toggled once per session).
  const { html, script } = await panelContent("modal");
  await editor.showPanel("modal" as any, MODAL_MODE, html, script, {
    key: "navigator:modal",
    preload: true,
    events: ["navigator:activate"],
  });
  await restoreDocks();
}

/**
 * Which views want a dock at boot: whatever was still open when this client
 * last ran (per slot, `dockedKey`), overridden by any view declaring
 * `openOnStart`. Restoring is passive -- the panel comes back, the editor
 * keeps focus, and a followEditor tree doesn't jump to the current page.
 */
async function restoreDocks() {
  // A narrow screen always boots with its drawers closed: there a dock covers
  // the editor whole, so restoring one would hide the page the user actually
  // navigated to. The same breakpoint the drawer layout uses, deliberately --
  // `editor.isMobile` asks about the pointer, which is the wrong question: a
  // narrow window with a mouse still gets a drawer.
  if (await editor.isNarrowScreen()) return;

  const forced = new Map<string, string>();
  // An empty Lua table crosses as `{}`, not `[]` -- and nothing declaring
  // openOnStart is the normal case.
  const raw = (await events.dispatchEvent("navigator:startup", {}))[0];
  const declared: { name?: string; dock?: string }[] = Array.isArray(raw)
    ? raw
    : [];
  for (const view of declared) {
    // `navigator.define` already rejects openOnStart on a modal view; this
    // only keeps a bridge event from putting one in a slot that can't hold it.
    if (view.name && view.dock && SIDEBAR_SLOTS.includes(view.dock)) {
      forced.set(view.dock, view.name);
    }
  }

  for (const slot of SIDEBAR_SLOTS) {
    let name = forced.get(slot);
    if (!name) {
      const saved = await datastore.get(dockedKey(slot));
      if (typeof saved !== "string") continue;
      const meta = await viewMeta(saved);
      // Skipped, not forgotten: a name that doesn't resolve right now is at
      // least as likely to be a view whose Space Lua hasn't been indexed yet
      // (a cold first boot, a space still syncing) as one that is really gone,
      // and forgetting it there would silently close a dock the user never
      // closed. It costs one dispatch per boot to keep trying.
      if (!meta) continue;
      // A dock mismatch *is* decisive: the view exists and lives somewhere
      // else now, so this slot's memory of it is stale by definition.
      if (meta.dock !== slot) {
        await datastore.del(dockedKey(slot));
        continue;
      }
      name = saved;
    }
    await show(name, true);
  }
}

import { config, system } from "@silverbulletmd/silverbullet/syscalls";
import { panelStyles } from "@silverbulletmd/silverbullet/lib/panel_styles";
import { createPanelLifecycle } from "@silverbulletmd/silverbullet/lib/panel_lifecycle";
import {
  openOnStartViews,
  register,
  resolveMeta,
  selectInFlight,
  unregister,
} from "./registry.ts";
import {
  buildPickSpec,
  commandDefinition,
  nextPickName,
  RESERVED_PICK_PREFIX,
  validateDefineSpec,
  type ViewSpec,
  wireMeta,
} from "./lua_views.ts";

const NAMESPACE = "navigator";
const MODAL_MODE = 100;
const MIN_WIDTH = 160;
const MAX_WIDTH = 600;
const DEFAULT_WIDTH = 260;

let assetBundle: Promise<{ css: string; js: string }> | undefined;

async function fetchAsset(path: string): Promise<string> {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`navigator: could not load ${path} (${response.status})`);
  }
  return await response.text();
}

function assets(): Promise<{ css: string; js: string }> {
  if (!assetBundle) {
    const pending = Promise.all([
      fetchAsset(".client/navigator.css"),
      fetchAsset(".client/navigator.js"),
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

let drainCounter = 0;

/**
 * Resolves behind every message already queued for this window. The panel
 * posts its syscalls with `postMessage`, and a same-window post lands on the
 * same task source, which the event loop drains in order -- so a select the
 * panel dispatched before this call is guaranteed to have been handled by the
 * time this resolves.
 */
function afterQueuedMessages(): Promise<void> {
  const token = `navigator:drain:${++drainCounter}`;
  return new Promise((resolve) => {
    const listener = (event: MessageEvent) => {
      if (event.data !== token) return;
      globalThis.removeEventListener("message", listener);
      resolve();
    };
    globalThis.addEventListener("message", listener);
    globalThis.postMessage(token);
  });
}

function settleAfterSelect(name: string, inFlight: Promise<any>) {
  void inFlight.finally(() => settlePick(name, null));
}

// Waits for an in-flight select before nulling the pick, so the bridge answer isn't raced out from under it -- including one the panel has posted but the host hasn't handled yet, which is what the drain waits out.
function supersede(name: string) {
  const inFlight = selectInFlight(name);
  if (inFlight) {
    settleAfterSelect(name, inFlight);
    return;
  }
  void afterQueuedMessages().then(() => {
    const late = selectInFlight(name);
    if (late) settleAfterSelect(name, late);
    else settlePick(name, null);
  });
}

const lifecycle = createPanelLifecycle({
  namespace: NAMESPACE,
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

export function openCommand(name: string) {
  return async (): Promise<boolean | undefined> => {
    if (await open(name)) return false;
  };
}

export function pickOpen(
  name: string,
  meta: any,
  spec: ViewSpec,
): Promise<unknown> {
  // settlePick before register, so this call's belt-and-suspenders settle can't unregister the meta it's about to register.
  settlePick(name, null);
  register({
    meta,
    spec,
    onPick: (obj: unknown) => settlePick(name, obj ?? null),
  });
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

export async function defineView(spec: ViewSpec): Promise<void> {
  validateDefineSpec(spec);
  const meta = wireMeta(spec);
  register({ meta, spec });
  const command = commandDefinition(spec, openCommand(meta.name));
  if (!command.name) return;
  // Written to config rather than registered with the command hook, so a
  // script reload's `config.clear()` retires it alongside the view itself.
  await config.set(["commands", command.name], command);
}

export function pickView(spec: ViewSpec): Promise<unknown> {
  const name = nextPickName();
  const internal = buildPickSpec(spec, name);
  return pickOpen(name, wireMeta(internal), internal);
}

export function openView(name: string, opts?: any): Promise<boolean> {
  if (typeof name === "string" && name.startsWith(RESERVED_PICK_PREFIX)) {
    throw new Error(
      `navigator.open: '${name}' is a navigator.pick view -- it can only be opened by the navigator.pick call that registered it`,
    );
  }
  if (opts !== undefined && opts !== null && typeof opts !== "object") {
    throw new Error("navigator.open: opts must be a table");
  }
  return open(name, opts);
}

export async function moveByRename(obj: any, newName: string): Promise<void> {
  if (obj.isFolder) {
    await system.invokeFunction("index.renamePrefixCommand", {
      oldPrefix: `${obj.name}/`,
      newPrefix: `${newName}/`,
      disableConfirmation: true,
    });
  }
  // A page that also has children needs both: renamePrefixCommand only touches files under "name/", so the page itself still needs its own rename.
  if (!obj.isFolder || obj.ref) {
    if (obj.tag === "document") {
      // A document's name already carries its extension, so the page rename (which appends ".md") would target the wrong file.
      await system.invokeFunction("index.renameDocumentCommand", {
        oldDocument: obj.name,
        document: newName,
      });
    } else {
      await system.invokeFunction("index.renamePageCommand", {
        oldPage: obj.name,
        page: newName,
      });
    }
  }
}

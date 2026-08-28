import { EditorView } from "@codemirror/view";
import {
  config,
  datastore,
  system,
} from "@silverbulletmd/silverbullet/syscalls";
import { createDockState } from "./dock_state.ts";
import {
  buildPickSpec,
  commandDefinition,
  nextPickName,
  RESERVED_PICK_PREFIX,
  type ViewSpec,
  validateDefineSpec,
  wireMeta,
} from "./lua_views.ts";
import { createPanelLifecycle } from "./panel_lifecycle.ts";
import { isPageDock, isWindowDock } from "./types.ts";
import {
  openOnStartViews,
  register,
  resolveMeta,
  selectInFlight,
  unregister,
} from "./registry.ts";

export type OpenOptions = {
  segment?: string;
  phrase?: string;
  quiet?: boolean;
  dropdown?: unknown;
  focus?: boolean;
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

// Waits for an in-flight select before nulling the pick, so a user's async
// `onSelect` still gets to answer the pick it was handed.
function supersede(name: string) {
  const inFlight = selectInFlight(name);
  if (inFlight) void inFlight.finally(() => settlePick(name, null));
  else settlePick(name, null);
}

// The space's `navigator.docks` table is read per resolution; `config.get`
// is synchronous-cached client-side so this is cheap.
let spaceDocks: Record<string, string> = {};
export function setSpaceDocks(docks: Record<string, string>): void {
  spaceDocks = docks ?? {};
}

export const dockState = createDockState({
  store: datastore,
  spaceDefault: (name) => spaceDocks[name],
});

export async function resolvedDock(name: string): Promise<string | undefined> {
  const meta = resolveMeta(name);
  if (!meta) return undefined;
  return dockState.resolveDock(name, meta);
}

const lifecycle = createPanelLifecycle({
  getMeta: resolveMeta,
  getForcedOpens: openOnStartViews,
  onSuperseded: supersede,
  onSlotClosedWithoutSuccessor: (view) => settlePick(view, null),
  resolveDock: (name, meta) => dockState.resolveDock(name, meta),
});

/**
 * Reveal a page-docked widget and put the keyboard somewhere useful in it,
 * reporting whether it actually took focus.
 * 
 * This has gotten a bit conthrived, but it seems to work
 */
async function revealPageWidget(name: string, dock: string): Promise<boolean> {
  const selector = `.sb-page-widget[data-view="${CSS.escape(name)}"]`;
  const scroller = client.editorView.scrollDOM;
  const savedScrollTop = scroller.scrollTop;
  let scrolled = false;
  if (!document.querySelector(selector)) {
    const side = dock === "page-top" ? "top" : "bottom";
    const cached = client.widgetCache.getCachedWidgetMeta(
      `pageslot:${side}:${client.currentPath()}`,
    );
    if (cached?.height !== 0) {
      client.editorView.dispatch({
        effects: EditorView.scrollIntoView(
          dock === "page-top" ? 0 : client.editorView.state.doc.length,
          { y: dock === "page-top" ? "start" : "end" },
        ),
      });
      scrolled = true;
    }
  }
  const settledSlot = `.sb-page-slot-${dock}[data-settled="1"]`;
  const el = await new Promise<HTMLElement | null>((resolve) => {
    const found = () => document.querySelector(selector) as HTMLElement | null;
    const decide = () => {
      const el = found();
      if (el) {
        settle(el);
        return;
      }
      if (document.querySelector(settledSlot)) settle(null);
    };
    const settle = (value: HTMLElement | null) => {
      observer.disconnect();
      clearTimeout(timer);
      resolve(value);
    };
    const existing = found();
    if (existing) return resolve(existing);
    const observer = new MutationObserver(decide);
    const root = document.querySelector("#sb-editor") ?? document.body;
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-settled"],
    });
    const timer = setTimeout(() => settle(null), 3000);
    decide();
  });
  if (el) {
    el.scrollIntoView({ block: "nearest" });
    const target =
      (el.querySelector(
        '.sb-page-widget-body [tabindex="0"]',
      ) as HTMLElement | null) ?? el;
    target.focus({ preventScroll: true });
    return el.contains(document.activeElement);
  }
  if (scrolled) {
    scroller.scrollTop = savedScrollTop;
  }
  return false;
}

async function openWithFocus(
  name: string,
  opts?: OpenOptions,
): Promise<{ opened: boolean; focused: boolean }> {
  const dock = await resolvedDock(name);
  if (dock && isPageDock(dock)) {
    await dockState.setOpen(name, true);
    client.rebuildEditorState();
    return { opened: true, focused: await revealPageWidget(name, dock) };
  }
  // A panel focuses its own input when it opens, so the two coincide here.
  const opened = await lifecycle.open(name, {
    quiet: opts?.quiet,
    phrase: opts?.phrase,
    segment: opts?.segment,
    dropdown: opts?.dropdown,
    focus: opts?.focus,
  });
  return { opened, focused: opened };
}

export async function open(name: string, opts?: OpenOptions): Promise<boolean> {
  return (await openWithFocus(name, opts)).opened;
}

export async function moveDock(name: string, dock: string): Promise<void> {
  const meta = resolveMeta(name);
  if (!meta) return;
  const before = await dockState.resolveDock(name, meta);
  await dockState.setDock(name, dock);
  if (isWindowDock(before) || before === "modal") await lifecycle.hide(before);
  if (isPageDock(before) || isPageDock(dock)) {
    await dockState.setOpen(name, isPageDock(dock));
    client.rebuildEditorState();
  }
  if (!isPageDock(dock)) await open(name);
}

export async function closeView(name: string, slot: string): Promise<void> {
  if (isPageDock(slot)) {
    await dockState.setOpen(name, false);
    client.rebuildEditorState();
    return;
  }
  await lifecycle.hide(slot);
}

export async function setViewCollapsed(
  name: string,
  collapsed: boolean,
): Promise<void> {
  await dockState.setCollapsed(name, collapsed);
}

export function focusPanel(slot?: string): boolean {
  const selector = slot
    ? `.sb-nav-root[data-slot="${CSS.escape(slot)}"]`
    : ".sb-nav-root";
  const input = document
    .querySelector(selector)
    ?.querySelector("input.sb-nav-input");
  if (!(input instanceof HTMLElement)) return false;
  input.focus();
  return true;
}

export function openCommand(name: string) {
  return async (): Promise<boolean | undefined> => {
    const { focused } = await openWithFocus(name);
    if (focused) return false;
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

export function hide(slot: string, expectedToken?: number): Promise<void> {
  return lifecycle.hide(slot, expectedToken);
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
}): Promise<void> {
  return lifecycle.resize(data);
}

export function restoreDocks(): Promise<void> {
  return lifecycle.restoreDocks();
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
      `view.open: '${name}' is a view.pick view -- it can only be opened by the view.pick call that registered it`,
    );
  }
  if (opts !== undefined && opts !== null && typeof opts !== "object") {
    throw new Error("view.open: opts must be a table");
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

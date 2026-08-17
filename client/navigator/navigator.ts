import { config, system } from "@silverbulletmd/silverbullet/syscalls";
import { createPanelLifecycle } from "./panel_lifecycle.ts";
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

// Waits for an in-flight select before nulling the pick, so a user's async
// `onSelect` still gets to answer the pick it was handed.
function supersede(name: string) {
  const inFlight = selectInFlight(name);
  if (inFlight) void inFlight.finally(() => settlePick(name, null));
  else settlePick(name, null);
}

const lifecycle = createPanelLifecycle({
  getMeta: resolveMeta,
  getForcedOpens: openOnStartViews,
  onSuperseded: supersede,
  onSlotClosedWithoutSuccessor: (view) => settlePick(view, null),
});

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

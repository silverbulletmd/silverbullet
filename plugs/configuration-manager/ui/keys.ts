import type { CommandOverride, PendingShortcuts } from "./types.ts";

export type { PendingShortcuts } from "./types.ts";

export function keyEventToNotation(
  e: KeyboardEvent,
  isMac: boolean,
): string | null {
  const parts: string[] = [];
  // Prefer CodeMirror's portable "Mod-" alias: Cmd on Mac, Ctrl elsewhere.
  if (isMac) {
    if (e.metaKey) parts.push("Mod");
    if (e.ctrlKey) parts.push("Ctrl");
  } else {
    if (e.ctrlKey) parts.push("Mod");
    if (e.metaKey) parts.push("Meta");
  }
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  const key = e.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return null;

  const keyMap: Record<string, string> = {
    ArrowUp: "ArrowUp",
    ArrowDown: "ArrowDown",
    ArrowLeft: "ArrowLeft",
    ArrowRight: "ArrowRight",
    Enter: "Enter",
    Escape: "Escape",
    Backspace: "Backspace",
    Delete: "Delete",
    Tab: "Tab",
    " ": "Space",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
  };

  let keyName = keyMap[key] || key;
  if (keyName.length === 1) keyName = keyName.toLowerCase();
  parts.push(keyName);
  return parts.join("-");
}

function pickPlatformRaw(src: { key?: any; mac?: any }, isMac: boolean): any {
  return isMac ? (src.mac ?? src.key) : src.key;
}

function toList(raw: any): string[] {
  if (Array.isArray(raw)) return raw.slice();
  return [raw];
}

export function manifestBindings(
  name: string,
  commands: Record<string, any>,
  isMac: boolean,
): string[] {
  const raw = pickPlatformRaw(commands[name], isMac);
  if (raw == null || raw === "") return [];
  return toList(raw);
}

export function overrideBindings(
  pendingEntry: CommandOverride | undefined,
  isMac: boolean,
): string[] | undefined {
  if (!pendingEntry) return undefined;
  const raw = pickPlatformRaw(pendingEntry, isMac);
  if (raw == null) return undefined;
  if (raw === "") return [];
  return toList(raw);
}

// A chord is "portable" when every stroke uses only Mod/Alt/Shift modifiers
// (no raw Ctrl/Cmd/Meta). Portable chords can live in `key` and work across
// platforms via CodeMirror's Mod-alias.
export function isPortableChord(chord: string): boolean {
  const tokens = tokenize(chord);
  for (const t of tokens) {
    const parts = t.split("-");
    for (const p of parts.slice(0, -1)) {
      if (p !== "Mod" && p !== "Alt" && p !== "Shift") return false;
    }
  }
  return true;
}

// Shift alone doesn't count as a "real" modifier — every capital letter already
// involves Shift, so requiring it would make any bare key look valid.
const REAL_MODIFIERS = new Set(["Ctrl", "Cmd", "Mod", "Alt", "Meta"]);

export function tokenHasRealModifier(token: string): boolean {
  const parts = token.split("-");
  if (parts.length < 2) return false;
  return parts.slice(0, -1).some((p) => REAL_MODIFIERS.has(p));
}

export function resolvedBindings(
  name: string,
  pendingShortcuts: PendingShortcuts,
  commands: Record<string, any>,
  isMac: boolean,
): string[] {
  const override = overrideBindings(pendingShortcuts[name], isMac);
  return override ?? manifestBindings(name, commands, isMac);
}

export function collapseBindings(list: string[]): string | string[] {
  if (list.length === 0) return "";
  if (list.length === 1) return list[0];
  return list.slice();
}

export function tokenize(binding: string): string[] {
  return binding.split(/\s+/).filter(Boolean);
}

// CodeMirror rejects keymaps where one binding is a strict prefix of another.
export function isPrefixOf(a: string[], b: string[]): boolean {
  if (a.length >= b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export type BindingEntry = { name: string; slot: number; binding: string };

export function allActiveBindings(
  pendingShortcuts: PendingShortcuts,
  commands: Record<string, any>,
  isMac: boolean,
): BindingEntry[] {
  const out: BindingEntry[] = [];
  for (const name of Object.keys(commands)) {
    const list = resolvedBindings(name, pendingShortcuts, commands, isMac);
    list.forEach((binding, slot) => {
      if (binding) out.push({ name, slot, binding });
    });
  }
  return out;
}

export type Conflicts = {
  prefixOfOther: BindingEntry[];
  otherIsPrefix: BindingEntry[];
  duplicate: BindingEntry[];
};

// Classify conflicts between the in-progress chord and every other binding.
// `prefixOfOther`: candidate is a strict prefix of another binding — soft warn.
// `otherIsPrefix`: another binding is a strict prefix of the candidate — hard
// block (unreachable). `duplicate`: exact match.
export function findConflicts(
  candidateTokens: string[],
  all: BindingEntry[],
  skip: { name: string; slot: number },
): Conflicts {
  const out: Conflicts = {
    prefixOfOther: [],
    otherIsPrefix: [],
    duplicate: [],
  };
  if (candidateTokens.length === 0) return out;
  for (const entry of all) {
    if (entry.name === skip.name && entry.slot === skip.slot) continue;
    const other = tokenize(entry.binding);
    if (
      other.length === candidateTokens.length &&
      other.every((t, i) => t === candidateTokens[i])
    ) {
      out.duplicate.push(entry);
    } else if (isPrefixOf(candidateTokens, other)) {
      out.prefixOfOther.push(entry);
    } else if (isPrefixOf(other, candidateTokens)) {
      out.otherIsPrefix.push(entry);
    }
  }
  return out;
}

export function hasAnyConflict(c: Conflicts): boolean {
  return (
    c.prefixOfOther.length > 0 ||
    c.otherIsPrefix.length > 0 ||
    c.duplicate.length > 0
  );
}

// Write `list` as the command's bindings. If every chord is portable we
// collapse to `key` and drop any `mac`. Otherwise write to the native field
// for the current platform.
export function writeBindings(
  pendingShortcuts: PendingShortcuts,
  name: string,
  list: string[],
  isMac: boolean,
): PendingShortcuts {
  const next: PendingShortcuts = { ...pendingShortcuts };
  const entry: CommandOverride = { ...(next[name] || {}) };
  const allPortable = list.every(isPortableChord);
  if (allPortable) {
    entry.key = collapseBindings(list);
    delete entry.mac;
  } else if (isMac) {
    entry.mac = collapseBindings(list);
  } else {
    entry.key = collapseBindings(list);
  }
  next[name] = entry;
  return next;
}

// Seed pendingShortcuts[name] from the manifest on first edit so subsequent
// edits apply on top of the command's existing bindings.
export function seedOverrideFromManifest(
  pendingShortcuts: PendingShortcuts,
  name: string,
  commands: Record<string, any>,
  isMac: boolean,
): PendingShortcuts {
  if (pendingShortcuts[name]) return pendingShortcuts;
  const next = { ...pendingShortcuts, [name]: {} };
  return writeBindings(next, name, manifestBindings(name, commands, isMac), isMac);
}

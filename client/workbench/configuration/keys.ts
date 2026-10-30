import type { CommandOverride } from "../../config_management/managed_lua.ts";

export type PendingShortcuts = Record<string, CommandOverride>;

/** A command as the Key bindings section shows it. */
export type CommandInfo = {
  name: string;
  key?: string | string[];
  mac?: string | string[];
  hide?: boolean;
};

export type Commands = Record<string, CommandInfo>;

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
  // On macOS, Option+<letter> rewrites e.key to an alternate glyph (e.g.
  // Option+R → "®"). Fall back to e.code for letters/digits so the binding
  // records the physical key the user pressed.
  if (isMac && e.altKey && !keyMap[key]) {
    const code = e.code;
    if (/^Key[A-Z]$/.test(code)) keyName = code.slice(3);
    else if (/^Digit[0-9]$/.test(code)) keyName = code.slice(5);
  }
  if (keyName.length === 1) keyName = keyName.toLowerCase();
  parts.push(keyName);
  return parts.join("-");
}

function pickPlatformRaw(
  src: CommandOverride,
  isMac: boolean,
): string | string[] | undefined {
  // `mac = ""` clears a macOS binding without shadowing `key`: the editor
  // treats an empty mac the same as an omitted one
  if (isMac && src.mac != null && src.mac !== "") return src.mac;
  return src.key;
}

function toList(raw: string | string[]): string[] {
  if (Array.isArray(raw)) return raw.slice();
  return [raw];
}

export function manifestBindings(
  name: string,
  commands: Commands,
  isMac: boolean,
): string[] {
  const command = commands[name];
  if (!command) return [];
  const raw = pickPlatformRaw(command, isMac);
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
  commands: Commands,
  isMac: boolean,
): string[] {
  const override = overrideBindings(pendingShortcuts[name], isMac);
  return override ?? manifestBindings(name, commands, isMac);
}

/**
 * Repairs an override saved before portable `key`s cleared `mac`: a portable
 * or empty `key` without `mac` never overrode the command's macOS binding.
 */
export function normalizeLoadedOverride(
  override: CommandOverride,
): CommandOverride {
  if (override.mac !== undefined || override.key === undefined) return override;
  const list = Array.isArray(override.key) ? override.key : [override.key];
  if (!list.every(isPortableChord)) return override;
  return { ...override, mac: "" };
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

const MODIFIER_ORDER = ["Mod", "Ctrl", "Meta", "Alt", "Shift"];

/**
 * One stroke as the key it fires on this platform: `Cmd-k` on a Mac and
 * `Ctrl-k` elsewhere are both `Mod-k`, so bindings written either way compare
 * equal to what the recorder produces.
 */
export function canonicalToken(token: string, isMac: boolean): string {
  const parts = token.split("-");
  let key = parts[parts.length - 1];
  // "Mod--" binds the minus key itself
  if (key === "" && parts.length > 1) key = "-";
  if (key.length === 1) key = key.toLowerCase();
  const modifiers = new Set(
    parts.slice(0, -1).map((m) => {
      if (isMac && (m === "Cmd" || m === "Meta")) return "Mod";
      if (!isMac && m === "Ctrl") return "Mod";
      return m;
    }),
  );
  const ordered = MODIFIER_ORDER.filter((m) => modifiers.has(m));
  return [...ordered, key].join("-");
}

export function allActiveBindings(
  pendingShortcuts: PendingShortcuts,
  commands: Commands,
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
  candidate: string[],
  all: BindingEntry[],
  skip: { name: string; slot: number },
  isMac = false,
): Conflicts {
  const candidateTokens = candidate.map((t) => canonicalToken(t, isMac));
  const out: Conflicts = {
    prefixOfOther: [],
    otherIsPrefix: [],
    duplicate: [],
  };
  if (candidateTokens.length === 0) return out;
  for (const entry of all) {
    if (entry.name === skip.name && entry.slot === skip.slot) continue;
    const other = tokenize(entry.binding).map((t) => canonicalToken(t, isMac));
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

/**
 * `override` with `list` as the command's bindings. Portable chords (and
 * clearing every chord) go in `key` and explicitly clear `mac`:
 * `command.update` merges, so leaving `mac` out keeps a built-in macOS
 * binding, which wins over `key` on macOS. Other chords go in the current
 * platform's field.
 */
export function withBindings(
  override: CommandOverride | undefined,
  list: string[],
  isMac: boolean,
): CommandOverride {
  const bindings = collapseBindings(list);
  if (list.every(isPortableChord)) {
    return { ...override, key: bindings, mac: "" };
  }
  return isMac
    ? { ...override, mac: bindings }
    : { ...override, key: bindings };
}

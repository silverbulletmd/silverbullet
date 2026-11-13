export const isMacLike =
  typeof navigator !== "undefined" &&
  /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);

/** The command's bindings for this platform, as a list */
function platformBindings(def: {
  key?: string | string[];
  mac?: string | string[];
}): string[] {
  const binding = isMacLike && def.mac ? def.mac : def.key;
  if (!binding) return [];
  return Array.isArray(binding) ? binding : [binding];
}

/**
 * The key hint a command shows: its platform-appropriate binding(s),
 * prettified. Several bindings for one command are joined with `|`.
 */
export function keyboardHint(def: {
  key?: string | string[];
  mac?: string | string[];
}): string | undefined {
  const shortcuts = platformBindings(def);
  if (shortcuts.length === 0) return undefined;
  return shortcuts.map(prettifyShortcut).join(" | ");
}

const ARROWS: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
};

/**
 * A compact key hint for a command in a menu or tooltip: only its first
 * platform-appropriate binding, prettified as the command palette does, with
 * arrow keys as arrows. A key sequence reads stroke by stroke, e.g.
 * "⌘. then H".
 */
export function firstKeyboardHint(def: {
  key?: string | string[];
  mac?: string | string[];
}): string | undefined {
  const first = platformBindings(def)[0];
  if (!first) return undefined;
  return first.trim().split(/\s+/).map(prettifyStroke).join(" then ");
}

/** One keystroke of a binding: prettified, a lone letter key upper-cased */
function prettifyStroke(stroke: string): string {
  const pretty = prettifyShortcut(
    isMacLike ? stroke : stroke.replace(/Mod-/g, "Ctrl-"),
  ).replace(/Arrow(Up|Down|Left|Right)/g, (name) => ARROWS[name]);
  // "h" in "Mod-. h"; modified keys keep the platform's own spelling
  return /^[a-z]$/.test(pretty) ? pretty.toUpperCase() : pretty;
}

export function prettifyShortcut(shortcut: string): string {
  if (!isMacLike) return shortcut;
  const pretty = shortcut
    .replace(/Mod-/g, "⌘")
    .replace(/Cmd-/g, "⌘")
    .replace(/Ctrl-/g, "⌃")
    .replace(/Alt-/g, "⌥")
    .replace(/Shift-/g, "⇧");
  return pretty.replace(
    /([⌘⌃⌥⇧])([a-z])$/,
    (_, mod, key) => mod + key.toUpperCase(),
  );
}

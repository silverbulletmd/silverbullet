export const isMacLike =
  typeof navigator !== "undefined" &&
  /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);

/** A single simultaneous keydown, in the shape a panel iframe can compare a
 * real `KeyboardEvent` against synchronously. */
export type ChordDescriptor = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

/**
 * The key hint a command shows: its platform-appropriate binding(s),
 * prettified. Several bindings for one command are joined with `|`.
 */
export function keyboardHint(def: {
  key?: string | string[];
  mac?: string | string[];
}): string | undefined {
  const binding = isMacLike && def.mac ? def.mac : def.key;
  if (!binding) return undefined;
  const shortcuts = Array.isArray(binding) ? binding : [binding];
  if (shortcuts.length === 0) return undefined;
  return shortcuts.map(prettifyShortcut).join(" | ");
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

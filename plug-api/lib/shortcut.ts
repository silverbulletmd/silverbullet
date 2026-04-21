export const isMacLike = typeof navigator !== "undefined" &&
  /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform);

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

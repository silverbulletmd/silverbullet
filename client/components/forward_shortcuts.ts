// Editing keys a text field in a panel handles itself, even with Cmd/Ctrl
const FIELD_KEYS = new Set([
  "a",
  "c",
  "v",
  "x",
  "z",
  "y",
  "arrowleft",
  "arrowright",
  "arrowup",
  "arrowdown",
  "home",
  "end",
  "backspace",
  "delete",
]);

/**
 * Hands Cmd/Ctrl shortcuts typed in a panel iframe to the app, so Cmd-K and
 * the like keep working while a panel has focus (the panel keeps every other
 * key, and the ones the app doesn't take). The panel's document is
 * same-origin: a srcdoc iframe. Returns the detach.
 */
export function forwardShortcuts(win: Window): () => void {
  const onKeyDown = (ev: KeyboardEvent) => {
    if (!ev.metaKey && !ev.ctrlKey) return;
    const target = ev.target as HTMLElement | null;
    if (
      target?.closest?.('input, textarea, select, [contenteditable="true"]') &&
      FIELD_KEYS.has(ev.key.toLowerCase())
    ) {
      return;
    }
    // Re-created in this window, bubbling, so the app's own key handling
    // sees it like a keystroke on the page
    const forwarded = new KeyboardEvent("keydown", {
      key: ev.key,
      code: ev.code,
      metaKey: ev.metaKey,
      ctrlKey: ev.ctrlKey,
      altKey: ev.altKey,
      shiftKey: ev.shiftKey,
      repeat: ev.repeat,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(forwarded);
    if (forwarded.defaultPrevented) {
      ev.preventDefault();
      ev.stopPropagation();
    }
  };
  win.addEventListener("keydown", onKeyDown, true);
  return () => win.removeEventListener("keydown", onKeyDown, true);
}

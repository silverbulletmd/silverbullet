/**
 * Core's narrow-screen (mobile) breakpoint: the width below which the app
 * switches to its narrow layout — notably in `client/styles/main.scss`, where
 * sidebar panels stop being columns and become full-width drawers over the
 * editor.
 *
 * SCSS can't import this, so `main.scss` restates the number; anything on the
 * TypeScript side that has to agree with that layout (the panel bridge, the
 * `editor.isNarrowScreen` syscall) reads it from here instead of restating it
 * a third time.
 */
export const MOBILE_MEDIA_QUERY = "(max-width: 600px)";

/** Whether the app is currently laid out for a narrow screen. */
export function isNarrowScreen(): boolean {
  return globalThis.matchMedia?.(MOBILE_MEDIA_QUERY).matches ?? false;
}

export const FINE_POINTER_MEDIA_QUERY = "(pointer: fine)";

export function isMobileDevice(): boolean {
  const query = globalThis.matchMedia?.(FINE_POINTER_MEDIA_QUERY);
  // Without matchMedia (SSR, tests), default to desktop.
  return query ? !query.matches : false;
}

let hardwareKeyboardLikely = false;

function isShortcutLike(ev: KeyboardEvent): boolean {
  if (ev.isComposing) return false;
  // Shift-only is typing (and OSK case transforms), not a command chord.
  return ev.metaKey || ev.ctrlKey || ev.altKey;
}

/**
 * Record a keydown that may have opened a modal. Installed at module load
 * so the chord is seen before the async command/open path asks for focus.
 */
export function noteKeyboardActivity(ev: KeyboardEvent): void {
  if (!isShortcutLike(ev)) return;
  // A modifier chord on a coarse-pointer device is almost always a real
  // keyboard (iPad / Android tablet). Remember it for later tap-opens too.
  hardwareKeyboardLikely = true;
}

function onKeyDown(ev: Event): void {
  if (ev instanceof KeyboardEvent) noteKeyboardActivity(ev);
}

function installKeyboardPresenceListener(): void {
  const target = globalThis.document ?? globalThis;
  if (typeof target.addEventListener !== "function") return;
  target.addEventListener("keydown", onKeyDown, true);
}

installKeyboardPresenceListener();

/** Test-only: forget hardware-keyboard state between cases. */
export function resetModalFilterFocusForTests(): void {
  hardwareKeyboardLikely = false;
}

/**
 * Whether a modal filter should take programmatic focus (and `autofocus`).
 *
 * Desktop (fine primary pointer) always focuses.
 *
 * On a touch device, a tap-open that `.focus()`es the filter leaves it
 * focused with no on-screen keyboard, and no tap can recover one — that
 * skip stays. A keyboard shortcut, or a physical keyboard already seen
 * this session, still focuses so Cmd+/ (and friends) can type immediately
 * on a tablet with a keyboard attached.
 */
export function shouldFocusModalFilter(): boolean {
  return !isMobileDevice() || hardwareKeyboardLikely;
}

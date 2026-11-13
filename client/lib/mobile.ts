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
let softKeyboardVisible = false;

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

/** Reported by `keyboard_viewport.ts` as the on-screen keyboard comes and goes. */
export function noteSoftKeyboardVisible(visible: boolean): void {
  softKeyboardVisible = visible;
}

/** Test-only: forget keyboard state between cases. */
export function resetModalFilterFocusForTests(): void {
  hardwareKeyboardLikely = false;
  softKeyboardVisible = false;
  primer?.blur();
}

/** How long a primed keyboard waits for an input to take over focus. */
export const KEYBOARD_PRIME_MS = 1500;

let primer: HTMLInputElement | undefined;
let primerTimer: ReturnType<typeof setTimeout> | undefined;

/** Whether a primed keyboard is up, waiting for an input to take it over. */
function keyboardPrimed(): boolean {
  return primer !== undefined && document.activeElement === primer;
}

/**
 * Bring up the on-screen keyboard for an input that is about to open.
 *
 * iOS raises the keyboard only for a focus made inside the user's tap, and a
 * picker opens a moment later, after its command has run. So, inside the
 * tap, focus a hidden input: the keyboard comes up, and when the picker's
 * filter takes focus the keyboard stays with it (see `shouldFocusModalFilter`).
 * If nothing takes over within `KEYBOARD_PRIME_MS`, the hidden input lets go
 * and the keyboard goes away again. Does nothing with a fine pointer.
 *
 * Must be called synchronously from the tap's event handler.
 */
export function primeSoftKeyboard(): void {
  if (!isMobileDevice() || typeof document === "undefined") return;
  if (!primer) {
    primer = document.createElement("input");
    primer.type = "text";
    primer.setAttribute("aria-hidden", "true");
    primer.tabIndex = -1;
    // 16px: iOS zooms the page into a focused input with smaller text
    primer.style.cssText =
      "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;pointer-events:none;";
    document.body.appendChild(primer);
  }
  primer.focus({ preventScroll: true });
  clearTimeout(primerTimer);
  primerTimer = setTimeout(() => primer?.blur(), KEYBOARD_PRIME_MS);
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
 * on a tablet with a keyboard attached. So does an on-screen keyboard that is
 * already up (e.g. opened from the keyboard bar): focus moves to the filter
 * and the keyboard stays, instead of typing on into the editor behind it.
 * And so does a keyboard a button primed with `primeSoftKeyboard`.
 */
export function shouldFocusModalFilter(): boolean {
  return (
    !isMobileDevice() ||
    hardwareKeyboardLikely ||
    softKeyboardVisible ||
    keyboardPrimed()
  );
}

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

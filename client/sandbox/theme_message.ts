import type { SpaceTheme } from "../space_theme.ts";

/**
 * Keeps an iframe on the theme on screen: posts it a `theme` message (see
 * `applyThemeMessage`) on every change, until the returned stop is called.
 * Its `html` message carries only the theme it rendered with.
 */
export function followTheme(
  spaceTheme: SpaceTheme,
  target: () => Window | null | undefined,
): () => void {
  return spaceTheme.onChange(() => {
    target()?.postMessage({ type: "theme", ...spaceTheme.message });
  });
}

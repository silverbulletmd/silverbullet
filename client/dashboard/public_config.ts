import {
  applyCachedGlobalFont,
  applyGlobalFont,
} from "@silverbulletmd/silverbullet/lib/fonts";

/** What `/.auth/central/public` tells anyone, signed in or not. */
type PublicConfig = { serverName?: unknown; defaultFont?: unknown };

let request: Promise<PublicConfig | undefined> | undefined;

/** The server's public settings, fetched once per page for every consumer. */
export function publicConfig(): Promise<PublicConfig | undefined> {
  request ??= fetch("/.auth/central/public")
    .then((response) => (response.ok ? response.json() : undefined))
    .catch(() => undefined);
  return request;
}

/**
 * Applies the server's default font to a dashboard or sign-in page: the
 * last one straight away, so the page doesn't flash, then the current one.
 */
export function loadServerDefaultFont(): void {
  applyCachedGlobalFont();
  void publicConfig().then((config) => {
    if (!config) return;
    applyGlobalFont(
      typeof config.defaultFont === "string" ? config.defaultFont : undefined,
    );
  });
}

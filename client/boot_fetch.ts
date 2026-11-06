import {
  notAuthenticatedError,
  offlineError,
} from "@silverbulletmd/silverbullet/constants";

export type BootFetchDeps = {
  fetch: typeof fetch;
  storage: Pick<Storage, "getItem" | "setItem">;
  /** Prefix for localStorage keys, scoped to this space's base URI. */
  cacheKeyPrefix: string;
  logoutInProgress: () => boolean;
  /** Opaque redirect: unregister service workers and reload the page. */
  resetAndReload: () => Promise<void>;
  navigate: (url: string) => void;
};

/** What one boot fetch got from the server. */
type Fetched =
  /** The server answered for this space: 2xx, or 404 for a missing file. */
  | { kind: "served"; status: number; text: string }
  /** Network error or 5xx: the server could not be reached. */
  | { kind: "unreachable" };

/**
 * Fetch the boot config (`.config`, which must parse as a JSON object) and the
 * bootstrap pages, falling back to the copies cached by the last good boot.
 *
 * The server is only trusted when `.config` comes back as valid JSON. While a
 * server restarts, a reverse proxy in front of it answers 404 or 503 for
 * everything; treating those 404s as empty files used to fail with "Unexpected
 * end of JSON input" and overwrite the good cached copies with "". Instead, a
 * boot whose `.config` is not usable reads every file from the cache and
 * caches nothing.
 */
export async function loadBootFiles(
  configPath: string,
  pagePaths: string[],
  deps: BootFetchDeps,
): Promise<{ configText: string; pageTexts: string[] }> {
  const paths = [configPath, ...pagePaths];
  const key = (path: string) => `${deps.cacheKeyPrefix}${path}`;
  // Set once a fetch must navigate away (auth redirect or service-worker
  // reset). That navigation aborts the sibling fetches; the flag makes them
  // report the redirect instead of looking offline.
  const navigation = { redirectingAway: false };
  const results = await Promise.all(
    paths.map((path) => fetchBootFile(path, deps, navigation)),
  );
  const config = results[0];

  if (config.kind === "served" && isJSONObject(config.text)) {
    const texts = results.map((result, i) => {
      if (result.kind === "served") {
        // A 404 is cached as "" so an offline boot can still serve it.
        deps.storage.setItem(key(paths[i]), result.text);
        return result.text;
      }
      const cached = deps.storage.getItem(key(paths[i]));
      if (cached === null) throw offlineError;
      console.info("Falling back to cache for", paths[i]);
      return cached;
    });
    return { configText: texts[0], pageTexts: texts.slice(1) };
  }

  // The server is not serving this space right now (unreachable, restarting
  // behind a proxy, or no space bound here): boot from the last good copies.
  const cachedConfig = deps.storage.getItem(key(configPath));
  if (cachedConfig === null || !isJSONObject(cachedConfig)) {
    if (config.kind === "unreachable") throw offlineError;
    throw new Error(
      `the server returned no space configuration (HTTP ${config.status})`,
    );
  }
  console.info(
    "Server did not return a usable boot config, booting from cached copies",
  );
  return {
    configText: cachedConfig,
    pageTexts: pagePaths.map((path) => deps.storage.getItem(key(path)) ?? ""),
  };
}

async function fetchBootFile(
  path: string,
  deps: BootFetchDeps,
  navigation: { redirectingAway: boolean },
): Promise<Fetched> {
  try {
    const response = await deps.fetch(path, {
      // We don't want to follow redirects, we want to get the redirect header in case of auth issues
      redirect: "manual",
      // Tinyauth/forward-auth can take longer than 1s on cold or remote auth checks.
      // Keep this bounded, but do not abort normal authenticated startup requests too aggressively.
      signal: AbortSignal.timeout(10000),
      headers: {
        "X-Sync-Mode": "1",
      },
    });
    if (response.status >= 500 && response.status < 600) {
      return { kind: "unreachable" };
    }
    if (response.status === 404) {
      return { kind: "served", status: 404, text: "" };
    }
    if (deps.logoutInProgress()) throw notAuthenticatedError;
    if (response.type === "opaqueredirect") {
      // We received an opaque redirect, there's little sensible we can do than unregister service workers and reload
      console.log(
        "Got opaque redirect, going to unregister service workers and reload",
      );
      navigation.redirectingAway = true;
      await deps.resetAndReload();
      throw notAuthenticatedError;
    }
    const redirectHeader = response.headers.get("location");
    if (redirectHeader) {
      console.info(
        "Received an (authentication) redirect, redirecting to URL: " +
          redirectHeader,
      );
      // Only the first fetch to see the redirect navigates; its siblings just
      // report the authentication failure.
      if (!navigation.redirectingAway) {
        navigation.redirectingAway = true;
        deps.navigate(redirectHeader);
      }
      throw notAuthenticatedError;
    }
    return {
      kind: "served",
      status: response.status,
      text: await response.text(),
    };
  } catch (e: any) {
    if (e.message === notAuthenticatedError.message) {
      throw e;
    }
    if (navigation.redirectingAway) {
      // Our own redirect-to-login (or reload) navigation aborted this fetch —
      // that's an authentication situation, not an offline one.
      throw notAuthenticatedError;
    }
    return { kind: "unreachable" };
  }
}

function isJSONObject(text: string): boolean {
  try {
    const value = JSON.parse(text);
    return typeof value === "object" && value !== null && !Array.isArray(value);
  } catch {
    return false;
  }
}

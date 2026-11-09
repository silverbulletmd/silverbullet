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
 * Fetch the boot config (`.config`, which must parse as a JSON object),
 * falling back to the copy cached by the last good boot.
 *
 * The server is only trusted when `.config` comes back as valid JSON. While a
 * server restarts, a reverse proxy in front of it answers 404 or 503 for
 * everything; treating that 404 as an empty file used to fail with
 * "Unexpected end of JSON input" and overwrite the good cached copy with "".
 * Instead, a boot whose `.config` is not usable reads the cache and caches
 * nothing.
 */
export async function loadBootFiles(
  configPath: string,
  deps: BootFetchDeps,
): Promise<{ configText: string }> {
  const key = `${deps.cacheKeyPrefix}${configPath}`;
  const config = await fetchBootFile(configPath, deps);

  if (config.kind === "served" && isJSONObject(config.text)) {
    deps.storage.setItem(key, config.text);
    return { configText: config.text };
  }

  // The server is not serving this space right now (unreachable, restarting
  // behind a proxy, or no space bound here): boot from the last good copy.
  const cachedConfig = deps.storage.getItem(key);
  if (cachedConfig === null || !isJSONObject(cachedConfig)) {
    if (config.kind === "unreachable") throw offlineError;
    throw new Error(
      `the server returned no space configuration (HTTP ${config.status})`,
    );
  }
  console.info(
    "Server did not return a usable boot config, booting from cached copies",
  );
  return { configText: cachedConfig };
}

async function fetchBootFile(
  path: string,
  deps: BootFetchDeps,
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
      await deps.resetAndReload();
      throw notAuthenticatedError;
    }
    const redirectHeader = response.headers.get("location");
    if (redirectHeader) {
      console.info(
        "Received an (authentication) redirect, redirecting to URL: " +
          redirectHeader,
      );
      deps.navigate(redirectHeader);
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

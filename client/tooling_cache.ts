import type { ToolingFile } from "./tooling.ts";
import type { ToolingCache } from "./tooling_fetch.ts";

// One Cache Storage cache per space: `silverbullet.<base URI>.tooling`
const namePrefix = "silverbullet.";
const nameSuffix = ".tooling";

/** The cache that holds the Library pages of the space at `baseURI`. */
const toolingCacheName = (baseURI: string) =>
  `${namePrefix}${baseURI}${nameSuffix}`;

/** Kept by the service worker when it clears out old caches. */
export function isToolingCacheName(name: string): boolean {
  return name.startsWith(namePrefix) && name.endsWith(nameSuffix);
}

/**
 * The payload's key in its cache. The service worker's `caches.match` looks
 * in every cache, so this must never be a URL the client requests: under the
 * real `.tooling` URL, this copy would answer live fetches.
 */
const payloadKey = ".tooling?cached";

/**
 * Cache Storage, which holds payloads too big for localStorage. Without it
 * there's no service worker either, so no offline boot to serve.
 */
export function cacheStorageToolingCache(
  baseURI: string,
): ToolingCache | undefined {
  if (!globalThis.caches) return undefined;
  const name = toolingCacheName(baseURI);
  return {
    async read(): Promise<ToolingFile[] | undefined> {
      const response = await (await caches.open(name)).match(payloadKey);
      return response?.json();
    },
    async write(files) {
      await (await caches.open(name)).put(
        payloadKey,
        new Response(JSON.stringify(files), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  };
}

/**
 * Where boot keeps its copy of the tooling payload. None with client
 * encryption (the payload is plain page text) or in a "Shared computer"
 * session (nothing may stay on the device).
 */
export function bootToolingCache(
  config: { enableClientEncryption?: boolean; ephemeralStorage?: boolean },
  baseURI: string,
): ToolingCache | undefined {
  return config.enableClientEncryption || config.ephemeralStorage
    ? undefined
    : cacheStorageToolingCache(baseURI);
}

/** Removes every space's cached Library pages: they hold plain page text. */
export async function deleteToolingCaches(): Promise<void> {
  if (!globalThis.caches) return;
  const names = (await caches.keys()).filter(isToolingCacheName);
  await Promise.all(names.map((name) => caches.delete(name)));
}

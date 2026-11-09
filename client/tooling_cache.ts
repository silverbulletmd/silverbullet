import type { ToolingFile } from "./tooling.ts";
import type { ToolingCache } from "./tooling_fetch.ts";

// One Cache Storage cache per space: `silverbullet.<base URI>.tooling`
const namePrefix = "silverbullet.";
const nameSuffix = ".tooling";

/** The cache that holds the tool pages of the space at `baseURI`. */
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

/** Boot's cache: none with client encryption, as it holds plain page text. */
export function bootToolingCache(
  enableClientEncryption: boolean,
  baseURI: string,
): ToolingCache | undefined {
  return enableClientEncryption ? undefined : cacheStorageToolingCache(baseURI);
}

/** Removes every space's cached tool pages: they hold plain page text. */
export async function deleteToolingCaches(): Promise<void> {
  if (!globalThis.caches) return;
  const names = (await caches.keys()).filter(isToolingCacheName);
  await Promise.all(names.map((name) => caches.delete(name)));
}

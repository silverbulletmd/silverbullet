import "@silverbulletmd/silverbullet/lib/native_fetch";
import { federatedPathToUrl } from "@silverbulletmd/silverbullet/lib/resolve";
import { datastore } from "@silverbulletmd/silverbullet/syscalls";
import type { FileMeta } from "../../plug-api/types.ts";
import { wildcardPathToRegex } from "./util.ts";

function responseToFileMeta(
  r: Response,
  name: string,
): FileMeta {
  return {
    name: name,
    size: r.headers.get("Content-length")
      ? +r.headers.get("Content-length")!
      : 0,
    contentType: r.headers.get("Content-type")!,
    perm: "ro",
    created: +(r.headers.get("X-Created") || "0"),
    lastModified: +(r.headers.get("X-Last-Modified") || "0"),
  };
}

const fileListingPrefixCacheKey = `federationListCache`;
const listingCacheTimeout = 1000 * 5;
const listingFetchTimeout = 2000;

type FileListingCacheEntry = {
  items: FileMeta[];
  lastUpdated: number;
};

export async function listFilesCached(
  uri: string,
  supportWildcards = false,
): Promise<FileMeta[]> {
  const uriParts = uri.split("/");
  const rootUri = uriParts[0];
  const prefix = uriParts.slice(1).join("/");
  console.log(
    "Fetching listing from federated",
    rootUri,
    "with prefix",
    prefix,
  );
  const cachedListing = await datastore.get(
    [fileListingPrefixCacheKey, rootUri],
  ) as FileListingCacheEntry;
  let items: FileMeta[] = [];
  if (
    cachedListing &&
    cachedListing.lastUpdated > Date.now() - listingCacheTimeout
  ) {
    console.info("Using cached listing", cachedListing.items.length);
    items = cachedListing.items;
  } else {
    const indexUrl = `${federatedPathToUrl(rootUri)}/index.json`;
    try {
      const fetchController = new AbortController();
      const timeout = setTimeout(
        () => fetchController.abort(),
        listingFetchTimeout,
      );

      const r = await nativeFetch(indexUrl, {
        method: "GET",
        headers: {
          "X-Sync-Mode": "true",
          "Cache-Control": "no-cache",
        },
        signal: fetchController.signal,
      });
      clearTimeout(timeout);

      if (r.status !== 200) {
        throw new Error(`Got status ${r.status}`);
      }
      const jsonResult = await r.json();
      // Transform them a little bit
      items = jsonResult.map((meta: FileMeta) => ({
        ...meta,
        perm: "ro",
        name: `${rootUri}/${meta.name}`,
      }));
      // Cache the entire listing
      await datastore.set([fileListingPrefixCacheKey, rootUri], {
        items,
        lastUpdated: Date.now(),
      } as FileListingCacheEntry);
    } catch (e: any) {
      console.error("Failed to process", indexUrl, e);
      if (cachedListing) {
        console.info("Using cached listing");
        return cachedListing.items;
      }
    }
  }
  // And then filter based on prefix before returning
  if (!supportWildcards) {
    return items.filter((meta: FileMeta) => meta.name.startsWith(uri));
  } else {
    const prefixRegex = wildcardPathToRegex(uri);
    return items.filter((meta) => prefixRegex.test(meta.name));
  }
}

export async function readFile(
  name: string,
): Promise<{ data: Uint8Array; meta: FileMeta }> {
  const url = federatedPathToUrl(name);
  console.log("Fetching federated file", url);
  const r = await nativeFetch(url, {
    method: "GET",
    headers: {
      Accept: "application/octet-stream",
    },
  });
  if (r.status === 503) {
    throw new Error("Offline");
  }
  const fileMeta = responseToFileMeta(r, name);
  if (r.status === 404) {
    throw Error("Not found");
  }
  const data = await r.arrayBuffer();
  if (!r.ok) {
    return errorResult(name, `**Error**: Could not load`);
  }

  return {
    data: new Uint8Array(data),
    meta: fileMeta,
  };
}

function errorResult(
  name: string,
  error: string,
): { data: Uint8Array; meta: FileMeta } {
  return {
    data: new TextEncoder().encode(error),
    meta: {
      name,
      contentType: "text/markdown",
      created: 0,
      lastModified: 0,
      size: 0,
      perm: "ro",
    },
  };
}

export function writeFile(
  _name: string,
  _data: Uint8Array,
): Promise<FileMeta> {
  throw new Error("Writing federation file, not yet supported");
}

export function deleteFile(
  _name: string,
): Promise<void> {
  throw new Error("Writing federation file, not yet supported");
}

export async function getFileMeta(name: string): Promise<FileMeta> {
  const url = federatedPathToUrl(name);
  console.info("Fetching federation file meta", url);
  const r = await nativeFetch(url, {
    method: "GET",
    headers: {
      "X-Sync-Mode": "true",
      "X-Get-Meta": "true",
    },
  });
  if (r.status === 503) {
    throw new Error("Offline");
  }
  const fileMeta = responseToFileMeta(r, name);
  if (!r.ok) {
    throw new Error("Not found");
  }
  return fileMeta;
}

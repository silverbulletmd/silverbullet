import "$sb/lib/native_fetch.ts";
import { federatedPathToUrl } from "$sb/lib/resolve.ts";
import { readFederationConfigs } from "./config.ts";
import { datastore } from "$sb/syscalls.ts";
import type { FileMeta } from "../../plug-api/types.ts";

async function responseToFileMeta(
  r: Response,
  name: string,
): Promise<FileMeta> {
  const federationConfigs = await readFederationConfigs();

  // Default permission is "ro" unless explicitly set otherwise
  let perm: "ro" | "rw" = "ro";
  const federationConfig = federationConfigs.find((config) =>
    name.startsWith(config.uri)
  );
  if (federationConfig?.perm) {
    perm = federationConfig.perm;
  }
  return {
    name: name,
    size: r.headers.get("Content-length")
      ? +r.headers.get("Content-length")!
      : 0,
    contentType: r.headers.get("Content-type")!,
    perm,
    created: +(r.headers.get("X-Created") || "0"),
    lastModified: +(r.headers.get("X-Last-Modified") || "0"),
  };
}

const fileListingPrefixCacheKey = `federationListCache`;
const listingCacheTimeout = 1000 * 30;
const listingFetchTimeout = 2000;

type FileListingCacheEntry = {
  items: FileMeta[];
  lastUpdated: number;
};

export async function listFiles(): Promise<FileMeta[]> {
  let fileMetas: FileMeta[] = [];
  // Fetch them all in parallel
  try {
    await Promise.all((await readFederationConfigs()).map(async (config) => {
      const items = await cacheFileListing(config.uri);
      fileMetas = fileMetas.concat(items);
    }));

    // console.log("All of em: ", fileMetas);
    return fileMetas;
  } catch (e: any) {
    console.error("Error listing federation files", e);
    return [];
  }
}

export async function cacheFileListing(uri: string): Promise<FileMeta[]> {
  const cachedListing = await datastore.get(
    [fileListingPrefixCacheKey, uri],
  ) as FileListingCacheEntry;
  if (
    cachedListing &&
    cachedListing.lastUpdated > Date.now() - listingCacheTimeout
  ) {
    // console.info("Using cached listing", cachedListing);
    return cachedListing.items;
  }
  console.log("Fetching listing from federated", uri);
  const uriParts = uri.split("/");
  const rootUri = uriParts[0];
  const prefix = uriParts.slice(1).join("/");
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
    const items: FileMeta[] = jsonResult.filter((meta: FileMeta) =>
      meta.name.startsWith(prefix)
    ).map((meta: FileMeta) => ({
      ...meta,
      perm: "ro",
      name: `${rootUri}/${meta.name}`,
    }));
    await datastore.set([fileListingPrefixCacheKey, uri], {
      items,
      lastUpdated: Date.now(),
    } as FileListingCacheEntry);
    return items;
  } catch (e: any) {
    console.error("Failed to process", indexUrl, e);
    if (cachedListing) {
      console.info("Using cached listing");
      return cachedListing.items;
    }
  }
  return [];
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
  const fileMeta = await responseToFileMeta(r, name);
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

export async function writeFile(
  name: string,
  data: Uint8Array,
): Promise<FileMeta> {
  throw new Error("Writing federation file, not yet supported");
  // const url = resolveFederated(name);
  // console.log("Writing federation file", url);

  // const r = await nativeFetch(url, {
  //   method: "PUT",
  //   body: data,
  // });
  // const fileMeta = await responseToFileMeta(r, name);
  // if (!r.ok) {
  //   throw new Error("Could not write file");
  // }

  // return fileMeta;
}

export async function deleteFile(
  name: string,
): Promise<void> {
  throw new Error("Writing federation file, not yet supported");

  // console.log("Deleting federation file", name);
  // const url = resolveFederated(name);
  // const r = await nativeFetch(url, { method: "DELETE" });
  // if (!r.ok) {
  //   throw Error("Failed to delete file");
  // }
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
  const fileMeta = await responseToFileMeta(r, name);
  if (!r.ok) {
    throw new Error("Not found");
  }
  return fileMeta;
}

import "$sb/lib/fetch.ts";
import type { FileMeta } from "../../common/types.ts";
import { readSetting } from "$sb/lib/settings_page.ts";

function resolveFederated(pageName: string): string {
  // URL without the prefix "!""
  let url = pageName.substring(1);
  if (!url.startsWith("127.0.0.1") && !url.startsWith("localhost")) {
    url = `https://${url}`;
  } else {
    url = `http://${url}`;
  }
  return url;
}

async function responseToFileMeta(
  r: Response,
  name: string,
): Promise<FileMeta> {
  let perm = r.headers.get("X-Permission") as any || "ro";
  const federationConfigs = await readFederationConfigs();
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
    perm: perm,
    lastModified: +(r.headers.get("X-Last-Modified") || "0"),
  };
}

type FederationConfig = {
  uri: string;
  perm?: "ro" | "rw";
};
let federationConfigs: FederationConfig[] = [];
let lastFederationUrlFetch = 0;

async function readFederationConfigs() {
  // Update at most every 5 seconds
  if (Date.now() > lastFederationUrlFetch + 5000) {
    federationConfigs = await readSetting("federate", []);
    // Normalize URIs
    for (const config of federationConfigs) {
      if (!config.uri.startsWith("!")) {
        config.uri = `!${config.uri}`;
      }
    }
    lastFederationUrlFetch = Date.now();
  }
  return federationConfigs;
}

export async function listFiles(): Promise<FileMeta[]> {
  let fileMetas: FileMeta[] = [];
  // Fetch them all in parallel
  await Promise.all((await readFederationConfigs()).map(async (config) => {
    // console.log("Fetching from federated", config);
    const uriParts = config.uri.split("/");
    const rootUri = uriParts[0];
    const prefix = uriParts.slice(1).join("/");
    const r = await nativeFetch(resolveFederated(rootUri));
    fileMetas = fileMetas.concat(
      (await r.json()).filter((meta: FileMeta) => meta.name.startsWith(prefix))
        .map((meta: FileMeta) => ({
          ...meta,
          perm: config.perm || meta.perm,
          name: `${rootUri}/${meta.name}`,
        })),
    );
  }));
  // console.log("All of em: ", fileMetas);
  return fileMetas;
}

export async function readFile(
  name: string,
): Promise<{ data: Uint8Array; meta: FileMeta } | undefined> {
  const url = resolveFederated(name);
  const r = await nativeFetch(url);
  const fileMeta = await responseToFileMeta(r, name);
  console.log("Fetching", url);
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
  const url = resolveFederated(name);
  console.log("Writing federation file", url);

  const r = await nativeFetch(url, {
    method: "PUT",
    body: data,
  });
  const fileMeta = await responseToFileMeta(r, name);
  if (!r.ok) {
    throw new Error("Could not write file");
  }

  return fileMeta;
}

export async function deleteFile(
  name: string,
): Promise<void> {
  console.log("Deleting federation file", name);
  const url = resolveFederated(name);
  const r = await nativeFetch(url, { method: "DELETE" });
  if (!r.ok) {
    throw Error("Failed to delete file");
  }
}

export async function getFileMeta(name: string): Promise<FileMeta> {
  const url = resolveFederated(name);
  console.log("Fetching federation file meta", url);
  const r = await nativeFetch(url, { method: "HEAD" });
  const fileMeta = await responseToFileMeta(r, name);
  if (!r.ok) {
    throw new Error("Not found");
  }
  return fileMeta;
}

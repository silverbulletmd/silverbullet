import "$sb/lib/fetch.ts";
import { mediaTypeToLoader } from "https://deno.land/x/esbuild_deno_loader@0.8.1/src/shared.ts";
import type { FileMeta } from "../../common/types.ts";
import { renderToText } from "../../plug-api/lib/tree.ts";
import { parseMarkdown } from "../../plug-api/silverbullet-syscall/markdown.ts";
import {
  federatedPrefix,
  translateLinksWithoutPrefix,
  translateLinksWithPrefix,
} from "./translate.ts";

function resolveFederated(pageName: string): string {
  // URL without the prefix "!""
  const originalUrl = pageName.substring(federatedPrefix.length);
  let url = originalUrl;
  if (!url.includes("/")) {
    url += "/index.md";
  }
  const pieces = url.split("/");
  pieces.splice(1, 0, ".fs");
  url = pieces.join("/");
  if (!url.startsWith("127.0.0.1") && !url.startsWith("localhost")) {
    url = `https://${url}`;
  } else {
    url = `http://${url}`;
  }
  return url;
}

// Extracts base URL from full URL, e.g. 'http://silverbullet.md/bla/die/dah' -> 'http://silverbullet.md'
function baseFederationUrl(url: string): string {
  const pieces = url.split("/");
  return federatedPrefix + pieces.slice(2, 3).join("/");
}

function responseToFileMeta(r: Response, name: string): FileMeta {
  return {
    name: name,
    size: r.headers.get("Content-length")
      ? +r.headers.get("Content-length")!
      : 0,
    contentType: r.headers.get("Content-type")!,
    perm: r.headers.get("X-Permission") as any || "ro",
    lastModified: +(r.headers.get("X-Last-Modified") || "0"),
  };
}

export async function listFiles(): Promise<FileMeta[]> {
  const r = await nativeFetch(`http://localhost:3001/.fs/`);
  const fileMetas: FileMeta[] = await r.json();
  return fileMetas.map((meta) => ({
    ...meta,
    name: `!localhost:3001/${meta.name}`,
  }));
}

export async function readFile(
  name: string,
): Promise<{ data: Uint8Array; meta: FileMeta } | undefined> {
  const url = resolveFederated(name);
  const r = await nativeFetch(url);
  const fileMeta = responseToFileMeta(r, name);
  console.log("Fetching", url);
  if (r.status === 404) {
    throw Error("Not found");
  }
  let data = await r.arrayBuffer();
  if (!r.ok) {
    return errorResult(name, `**Error**: Could not load`);
  }

  if (name.endsWith(".md")) {
    let text = new TextDecoder().decode(data);
    text = renderToText(
      translateLinksWithPrefix(
        await parseMarkdown(text),
        baseFederationUrl(url) + "/",
      ),
    );
    data = new TextEncoder().encode(text);
  }
  return {
    data: new Uint8Array(data),
    meta: fileMeta,
  };
  // } catch (e: any) {
  //   console.error("ERROR thrown", e.message);
  //   return errorResult(name, `**Error**: ${e.message}`);
  // }
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
  if (name.endsWith(".md")) {
    let text = new TextDecoder().decode(data);
    text = renderToText(translateLinksWithoutPrefix(
      await parseMarkdown(text),
      baseFederationUrl(url) + "/",
    ));
    data = new TextEncoder().encode(text);
  }

  const r = await nativeFetch(url, {
    method: "PUT",
    body: data,
  });
  const fileMeta = responseToFileMeta(r, name);
  if (!r.ok) {
    throw new Error("Could not write file");
  }

  return fileMeta;
}

export function deleteFile(
  name: string,
): Promise<void> {
  console.log("Deleting federation file", name);
  return;
}

export async function getFileMeta(name: string): Promise<FileMeta> {
  const url = resolveFederated(name);
  console.log("Fetching for OPTIONS", url);
  const r = await nativeFetch(url, { method: "OPTIONS" });
  const fileMeta = responseToFileMeta(r, name);
  if (!r.ok) {
    throw new Error("Not found");
  }
  return fileMeta;
}

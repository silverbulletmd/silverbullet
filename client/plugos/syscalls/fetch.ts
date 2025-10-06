import type { SysCallMapping } from "../system.ts";
import type {
  ProxyFetchRequest,
  ProxyFetchRequest64,
  ProxyFetchResponse,
  ProxyFetchResponse64,
} from "../proxy_fetch.ts";
import type { Client } from "../../client.ts";
import {
  base64Decode,
  base64Encode,
} from "@silverbulletmd/silverbullet/lib/crypto";
import { fsEndpoint } from "../../spaces/constants.ts";

export function sandboxFetchSyscalls(
  client: Client,
): SysCallMapping {
  return {
    // For use in Lua
    "http.request": async (
      _ctx,
      url: string,
      options: ProxyFetchRequest = {},
    ): Promise<ProxyFetchResponse> => {
      // JSONify any non-serializable body
      if (
        options?.body && typeof options.body !== "string" &&
        !(options.body instanceof Uint8Array)
      ) {
        options.body = JSON.stringify(options.body);
      }
      const fetchOptions = options
        ? {
          method: options.method,
          headers: {} as Record<string, string>,
          body: options.body,
        }
        : {};
      fetchOptions.headers = buildProxyHeaders(options.headers);
      const resp = await client.httpSpacePrimitives.authenticatedFetch(
        buildProxyUrl(client, url),
        fetchOptions,
      );
      // Do sensible things with the body based on the content type
      let body: any;
      if (resp.headers.get("Content-Type")?.startsWith("application/json")) {
        body = await resp.json();
      } else if (
        resp.headers.get("Content-Type")?.startsWith("application/xml") ||
        resp.headers.get("Content-Type")?.startsWith("text/")
      ) {
        body = await resp.text();
      } else {
        body = new Uint8Array(await resp.arrayBuffer());
      }
      return {
        ok: resp.ok,
        status: resp.status,
        headers: extractProxyHeaders(resp.headers),
        body: body,
      };
    },
    "sandboxFetch.fetch": async (
      _ctx,
      url: string,
      options?: ProxyFetchRequest64,
    ): Promise<ProxyFetchResponse64> => {
      // console.log("Got sandbox fetch ", url, op);
      const fetchOptions = options
        ? {
          method: options.method,
          headers: options.headers,
          body: options.base64Body && base64Decode(options.base64Body),
        }
        : {};
      fetchOptions.headers = fetchOptions.headers ?? {};
      const resp = await client.httpSpacePrimitives.authenticatedFetch(
        buildProxyUrl(client, url),
        // Casting this to any because of weird Deno typing
        fetchOptions as any,
      );
      const body = await resp.arrayBuffer();
      return {
        ok: resp.ok,
        status: resp.status,
        headers: extractProxyHeaders(resp.headers),
        base64Body: base64Encode(new Uint8Array(body)),
      };
    },
  };
}

function buildProxyUrl(client: Client, url: string) {
  url = url.replace(/^https?:\/\//, "");
  // Strip off the /.fs and replace with /.proxy
  return client.httpSpacePrimitives.url.slice(0, -fsEndpoint.length) +
    "/.proxy/" + url;
}

function buildProxyHeaders(headers?: Record<string, any>): Record<string, any> {
  const newHeaders: Record<string, any> = { "X-Proxy-Request": "true" };
  if (!headers) {
    return newHeaders;
  }
  for (const [key, value] of Object.entries(headers)) {
    newHeaders[`X-Proxy-Header-${key}`] = value;
  }
  return newHeaders;
}

function extractProxyHeaders(
  headers: Headers,
): Record<string, any> {
  const newHeaders: Record<string, any> = {};
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase().startsWith("x-proxy-header-")) {
      newHeaders[key.slice("x-proxy-header-".length)] = value;
    }
  }
  return newHeaders;
}

import type { SysCallMapping } from "$lib/plugos/system.ts";
import {
  performLocalFetch,
  type ProxyFetchRequest,
  type ProxyFetchRequest64,
  type ProxyFetchResponse,
  type ProxyFetchResponse64,
} from "$lib/proxy_fetch.ts";
import type { Client } from "../client.ts";
import { base64Decode, base64Encode } from "$lib/crypto.ts";

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
      url = url.replace(/^https?:\/\//, "");
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
          headers: options.headers,
          body: options.body,
        }
        : {};
      fetchOptions.headers = { "X-Proxy-Request": "true" };
      // Copy the headers from the options prefixed with X-Proxy-Header
      if (options.headers) {
        for (const [k, v] of Object.entries(options.headers)) {
          fetchOptions.headers[`X-Proxy-Header-${k}`] = v;
        }
      }
      const resp = await client.httpSpacePrimitives.authenticatedFetch(
        `${client.httpSpacePrimitives.url}/!${url}`,
        fetchOptions,
      );
      // Do sensible things with the body based on the content type
      let body: any;
      if (resp.headers.get("Content-Type")?.startsWith("application/json")) {
        body = await resp.json();
      } else if (resp.headers.get("Content-Type")?.startsWith("application/xml") || resp.headers.get("Content-Type")?.startsWith("text/")) {
        body = await resp.text();
      } else {
        body = new Uint8Array(await resp.arrayBuffer());
      }
      return {
        ok: resp.ok,
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        body: body,
      };
    },
    "sandboxFetch.fetch": async (
      _ctx,
      url: string,
      options?: ProxyFetchRequest64,
    ): Promise<ProxyFetchResponse64> => {
      // console.log("Got sandbox fetch ", url, op);
      url = url.replace(/^https?:\/\//, "");
      const fetchOptions = options
        ? {
          method: options.method,
          headers: options.headers,
          body: options.base64Body && base64Decode(options.base64Body),
        }
        : {};
      if (!client.httpSpacePrimitives) {
        // No SB server to proxy the fetch available so let's execute the request directly
        return performLocalFetch(url, fetchOptions);
      }
      fetchOptions.headers = fetchOptions.headers
        ? { ...fetchOptions.headers, "X-Proxy-Request": "true" }
        : { "X-Proxy-Request": "true" };
      const resp = await client.httpSpacePrimitives.authenticatedFetch(
        `${client.httpSpacePrimitives.url}/!${url}`,
        fetchOptions,
      );
      const body = await resp.arrayBuffer();
      return {
        ok: resp.ok,
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        base64Body: base64Encode(new Uint8Array(body)),
      };
    },
  };
}

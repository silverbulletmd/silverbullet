import type { SysCallMapping } from "$lib/plugos/system.ts";
import {
  performLocalFetch,
  ProxyFetchRequest,
  ProxyFetchResponse,
} from "../../lib/proxy_fetch.ts";
import type { Client } from "../client.ts";
import { base64Decode, base64Encode } from "$lib/crypto.ts";

export function sandboxFetchSyscalls(
  client: Client,
): SysCallMapping {
  return {
    "sandboxFetch.fetch": async (
      _ctx,
      url: string,
      options?: ProxyFetchRequest,
    ): Promise<ProxyFetchResponse> => {
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

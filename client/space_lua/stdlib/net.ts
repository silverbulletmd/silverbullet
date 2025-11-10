import type { Client } from "../../client.ts";
import type {
  ProxyFetchRequest,
  ProxyFetchResponse,
} from "../../plugos/proxy_fetch.ts";
import { fsEndpoint } from "../../spaces/constants.ts";
import { LuaNativeJSFunction, LuaTable } from "../runtime.ts";

export const netApi = new LuaTable({
  proxyFetch: new LuaNativeJSFunction(
    async (
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
      const contentTypeHeader = options.responseEncoding ||
        resp.headers.get("x-proxy-header-content-type");
      const statusCode = +(resp.headers.get("x-proxy-status-code") || "200");
      if (contentTypeHeader?.startsWith("application/json")) {
        body = await resp.json();
      } else if (
        contentTypeHeader?.startsWith("application/xml") ||
        contentTypeHeader?.startsWith("text/")
      ) {
        body = await resp.text();
      } else {
        body = new Uint8Array(await resp.arrayBuffer());
      }
      return {
        ok: resp.ok,
        status: statusCode,
        headers: extractProxyHeaders(resp.headers),
        body: body,
      };
    },
  ),
  readURI: new LuaNativeJSFunction(
    (uri: string, options: { uri?: string; encoding?: string } = {}) => {
      options.uri = uri;
      return client.clientSystem.serviceRegistry.invokeBestMatch(
        "net.readURI:" + uri,
        options,
      );
    },
  ),
  writeURI: new LuaNativeJSFunction(
    (uri: string, content: string | Uint8Array) => {
      return client.clientSystem.serviceRegistry.invokeBestMatch(
        "net.writeURI:" + uri,
        { uri, content },
      );
    },
  ),
});

// Utility functions
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

import type { Client } from "../../client.ts";
import type {
  ProxyFetchRequest,
  ProxyFetchResponse,
} from "../../plugos/proxy_fetch.ts";
import { fsEndpoint } from "../../spaces/constants.ts";
import { LuaNativeJSFunction, LuaTable } from "../runtime.ts";

export async function proxyFetch(
  url: string,
  options: ProxyFetchRequest = {},
): Promise<ProxyFetchResponse> {
  // A table body is sent as JSON
  const requestBody =
    options.body &&
    typeof options.body !== "string" &&
    !(options.body instanceof Uint8Array)
      ? JSON.stringify(options.body)
      : options.body;
  const resp = await client.httpSpacePrimitives.authenticatedFetch(
    buildProxyUrl(client, url),
    {
      method: options.method,
      headers: buildProxyHeaders(options.headers),
      body: requestBody,
    },
  );
  if (resp.status !== 200) {
    return {
      ok: false,
      status: resp.status,
      headers: extractProxyHeaders(resp.headers),
      body: await resp.text(),
    };
  }
  // Read as ArrayBuffer first to safely handle empty responses (e.g.
  // PUT/DELETE returning 204 with Content-Type: application/json).
  // resp.arrayBuffer() never throws on an empty body, whereas
  // resp.json() would throw a SyntaxError.
  const rawBytes = new Uint8Array(await resp.arrayBuffer());
  let body: any;
  const contentTypeHeader =
    options.responseEncoding || resp.headers.get("x-proxy-header-content-type");
  const statusCode = +(resp.headers.get("x-proxy-status-code") || "200");
  if (rawBytes.length === 0) {
    body = null;
  } else if (contentTypeHeader?.startsWith("application/json")) {
    body = JSON.parse(new TextDecoder().decode(rawBytes));
  } else if (
    contentTypeHeader?.startsWith("application/xml") ||
    contentTypeHeader?.startsWith("text/")
  ) {
    body = new TextDecoder().decode(rawBytes);
  } else {
    body = rawBytes;
  }
  return {
    // The upstream's, not the proxy's (which answered 200)
    ok: statusCode >= 200 && statusCode < 300,
    status: statusCode,
    headers: extractProxyHeaders(resp.headers),
    body: body,
  };
}

export const netApi = new LuaTable({
  proxyFetch: new LuaNativeJSFunction({
    callback: proxyFetch,
    description:
      "Performs an HTTP request through the SilverBullet server to avoid browser CORS restrictions.",
    signatures: ["net.proxyFetch(url, options?)"],
    parameters: [
      { name: "url", type: "string", description: "URL to request." },
      {
        name: "options",
        type: "table",
        description:
          "Optional method, headers, body, and responseEncoding values.",
        optional: true,
      },
    ],
    returns: [
      {
        type: "table",
        description: "Response status, headers, decoded body, and ok flag.",
      },
    ],
    see: "API/net",
  }),
  readURI: new LuaNativeJSFunction({
    callback: (
      uri: string,
      options: { uri?: string; encoding?: string } = {},
    ) => {
      options.uri = uri;
      return client.clientSystem.serviceRegistry.invokeBestMatch(
        `net.readURI:${uri}`,
        options,
      );
    },
    description: "Reads content from a URI using the best matching service.",
    signatures: ["net.readURI(uri, options?)"],
    parameters: [
      { name: "uri", type: "string", description: "URI to read." },
      {
        name: "options",
        type: "table",
        description: "Optional service-specific values such as encoding.",
        optional: true,
      },
    ],
    returns: [{ description: "Content returned by the matching service." }],
    see: "API/net",
  }),
  writeURI: new LuaNativeJSFunction({
    callback: (
      uri: string,
      content: string | Uint8Array,
      options: Record<string, unknown> = {},
    ) => {
      return client.clientSystem.serviceRegistry.invokeBestMatch(
        `net.writeURI:${uri}`,
        { ...options, uri, content },
      );
    },
    description: "Writes content to a URI using the best matching service.",
    signatures: ["net.writeURI(uri, content, options?)"],
    parameters: [
      { name: "uri", type: "string", description: "URI to write." },
      {
        name: "content",
        type: "string|userdata",
        description: "Text or binary content to write.",
      },
      {
        name: "options",
        type: "table",
        description:
          "Optional service-specific values, such as conditional = true for a write that fails when the remote changed since it was last read.",
        optional: true,
      },
    ],
    returns: [{ description: "Result returned by the matching service." }],
    see: "API/net",
  }),
});

function buildProxyUrl(client: Client, url: string) {
  url = url.replace(/^https?:\/\//, "");
  return (
    client.httpSpacePrimitives.url.slice(0, -fsEndpoint.length) +
    "/.proxy/" +
    url
  );
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

function extractProxyHeaders(headers: Headers): Record<string, any> {
  const newHeaders: Record<string, any> = {};
  for (const [key, value] of headers.entries()) {
    if (key.toLowerCase().startsWith("x-proxy-header-")) {
      newHeaders[key.slice("x-proxy-header-".length)] = value;
    }
  }
  return newHeaders;
}

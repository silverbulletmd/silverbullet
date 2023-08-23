import { init } from "https://esm.sh/v131/node_events.js";
import type {
  ProxyFetchRequest,
  ProxyFetchResponse,
} from "../../common/proxy_fetch.ts";
import {
  base64Decode,
  base64Encode,
} from "../../plugos/asset_bundle/base64.ts";

export async function sandboxFetch(
  reqInfo: RequestInfo,
  options?: ProxyFetchRequest,
): Promise<ProxyFetchResponse> {
  if (typeof reqInfo !== "string") {
    // Request as first argument, let's deconstruct it
    // console.log("fetch", reqInfo);
    options = {
      method: reqInfo.method,
      headers: Object.fromEntries(reqInfo.headers.entries()),
      base64Body: reqInfo.body
        ? base64Encode(
          new Uint8Array(await (new Response(reqInfo.body)).arrayBuffer()),
        )
        : undefined,
    };
    reqInfo = reqInfo.url;
  }
  // @ts-ignore: monkey patching fetch
  return syscall("sandboxFetch.fetch", reqInfo, options);
}

export function monkeyPatchFetch() {
  // @ts-ignore: monkey patching fetch
  globalThis.nativeFetch = globalThis.fetch;
  // @ts-ignore: monkey patching fetch
  globalThis.fetch = async function (
    reqInfo: RequestInfo,
    init?: RequestInit,
  ): Promise<Response> {
    const r = await sandboxFetch(
      reqInfo,
      init && {
        method: init.method,
        headers: init.headers as Record<string, string>,
        base64Body: init.body
          ? base64Encode(
            new Uint8Array(await (new Response(init.body)).arrayBuffer()),
          )
          : undefined,
      },
    );
    return new Response(r.base64Body ? base64Decode(r.base64Body) : null, {
      status: r.status,
      headers: r.headers,
    });
  };
}

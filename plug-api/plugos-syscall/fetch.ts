import type {
  ProxyFetchRequest,
  ProxyFetchResponse,
} from "../../common/proxy_fetch.ts";
import { base64Decode } from "../../plugos/asset_bundle/base64.ts";

export function sandboxFetch(
  url: string,
  options?: ProxyFetchRequest,
): Promise<ProxyFetchResponse> {
  // @ts-ignore: monkey patching fetch
  return syscall("sandboxFetch.fetch", url, options);
}

export function monkeyPatchFetch() {
  // @ts-ignore: monkey patching fetch
  globalThis.fetch = async function (
    url: string,
    init?: RequestInit,
  ): Promise<Response> {
    const r = await sandboxFetch(
      url,
      init && {
        method: init.method,
        headers: init.headers as Record<string, string>,
        body: init.body as string,
      },
    );
    return new Response(r.base64Body ? base64Decode(r.base64Body) : null, {
      status: r.status,
      headers: r.headers,
    });
  };
}

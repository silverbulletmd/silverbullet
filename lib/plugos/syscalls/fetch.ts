import type { SysCallMapping } from "../system.ts";
import { ProxyFetchRequest, ProxyFetchResponse } from "../../proxy_fetch.ts";
import { base64Encode } from "../../crypto.ts";

export function sandboxFetchSyscalls(): SysCallMapping {
  return {
    "sandboxFetch.fetch": async (
      _ctx,
      url: string,
      options: ProxyFetchRequest,
    ): Promise<ProxyFetchResponse> => {
      // console.log("Got sandbox fetch ", url);
      const resp = await fetch(url, options);
      return {
        status: resp.status,
        ok: resp.ok,
        headers: Object.fromEntries(resp.headers.entries()),
        base64Body: base64Encode(new Uint8Array(await resp.arrayBuffer())),
      };
    },
  };
}

import type { SysCallMapping } from "../../plugos/system.ts";
import {
  performLocalFetch,
  ProxyFetchRequest,
  ProxyFetchResponse,
} from "../../common/proxy_fetch.ts";
import type { Client } from "../client.ts";

export function sandboxFetchSyscalls(
  client: Client,
): SysCallMapping {
  return {
    "sandboxFetch.fetch": async (
      _ctx,
      url: string,
      options: ProxyFetchRequest,
    ): Promise<ProxyFetchResponse> => {
      // console.log("Got sandbox fetch ", url);
      if (!client.remoteSpacePrimitives) {
        // No SB server to proxy the fetch available so let's execute the request directly
        return performLocalFetch(url, options);
      }
      const resp = client.remoteSpacePrimitives.authenticatedFetch(
        `${client.remoteSpacePrimitives.url}/.rpc`,
        {
          method: "POST",
          body: JSON.stringify({
            operation: "fetch",
            url,
            options,
          }),
        },
      );
      return (await resp).json();
    },
  };
}

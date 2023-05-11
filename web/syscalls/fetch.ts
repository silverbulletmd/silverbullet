import type { SysCallMapping } from "../../plugos/system.ts";
import type { HttpSpacePrimitives } from "../../common/spaces/http_space_primitives.ts";
import {
  performLocalFetch,
  ProxyFetchRequest,
  ProxyFetchResponse,
} from "../../common/proxy_fetch.ts";

export function sandboxFetchSyscalls(
  httpSpacePrimitives?: HttpSpacePrimitives,
): SysCallMapping {
  return {
    "sandboxFetch.fetch": async (
      _ctx,
      url: string,
      options: ProxyFetchRequest,
    ): Promise<ProxyFetchResponse> => {
      // console.log("Got sandbox fetch ", url);
      if (!httpSpacePrimitives) {
        // No SB server to proxy the fetch available so let's execute the request directly
        return performLocalFetch(url, options);
      }
      const resp = httpSpacePrimitives.authenticatedFetch(
        httpSpacePrimitives.url,
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

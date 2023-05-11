import type { SysCallMapping } from "../../plugos/system.ts";
import type { SandboxFetchRequest } from "../../plug-api/plugos-syscall/fetch.ts";
import type { HttpSpacePrimitives } from "../../common/spaces/http_space_primitives.ts";
import { base64Encode } from "../../plugos/asset_bundle/base64.ts";

export function sandboxFetchSyscalls(
  httpSpacePrimitives?: HttpSpacePrimitives,
): SysCallMapping {
  return {
    "sandboxFetch.fetch": async (
      _ctx,
      url: string,
      req: SandboxFetchRequest,
    ) => {
      if (!httpSpacePrimitives) {
        // Execute from the browser directly
        const result = await fetch(
          url,
          req && {
            method: req.method,
            headers: req.headers,
            body: req.body,
          },
        );
        const body = await (await result.blob()).arrayBuffer();
        return {
          ok: result.ok,
          status: result.status,
          headers: Object.fromEntries(result.headers.entries()),
          base64Body: base64Encode(new Uint8Array(body)),
        };
      }
      httpSpacePrimitives.authenticatedFetch(url, {
        method: "POST",
      });
    },
  };
}

import type {
  SandboxFetchRequest,
  SandboxFetchResponse,
} from "../../plug-api/plugos-syscall/fetch.ts";
import { base64Encode } from "../asset_bundle/base64.ts";
import { SysCallMapping } from "../system.ts";

export async function sandboxFetch(
  url: string,
  req?: SandboxFetchRequest,
): Promise<SandboxFetchResponse> {
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

export function sandboxFetchSyscalls(): SysCallMapping {
  return {
    "sandboxFetch.fetch": (
      _ctx,
      url: string,
      options?: SandboxFetchRequest,
    ): Promise<SandboxFetchResponse> => {
      return sandboxFetch(url, options);
    },
  };
}

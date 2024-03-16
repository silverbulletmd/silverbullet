import { base64Decode, base64Encode } from "./crypto.ts";

export type ProxyFetchRequest = {
  method?: string;
  headers?: Record<string, string>;
  base64Body?: string;
};

export type ProxyFetchResponse = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  // We base64 encode the body because the body can be binary data that we have to push through the worker boundary
  base64Body: string;
};

export async function performLocalFetch(
  url: string,
  req: ProxyFetchRequest,
): Promise<ProxyFetchResponse> {
  const result = await fetch(
    url,
    req && {
      method: req.method,
      headers: req.headers,
      body: req.base64Body && base64Decode(req.base64Body),
    },
  );
  return {
    ok: result.ok,
    status: result.status,
    headers: Object.fromEntries(result.headers.entries()),
    base64Body: base64Encode(
      new Uint8Array(await (await result.blob()).arrayBuffer()),
    ),
  };
}

import type {
  ProxyFetchRequest,
  ProxyFetchResponse,
} from "../../common/proxy_fetch.ts";
import {
  base64Decode,
  base64Encode,
} from "../../plugos/asset_bundle/base64.ts";

async function readStream(
  stream: ReadableStream<Uint8Array>,
): Promise<Uint8Array> {
  const arrays: Uint8Array[] = [];
  let totalRead = 0;
  const reader = stream.getReader();
  while (true) {
    // The `read()` method returns a promise that
    // resolves when a value has been received.
    const { done, value } = await reader.read();
    // Result objects contain two properties:
    // `done`  - `true` if the stream has already given you all its data.
    // `value` - Some data. Always `undefined` when `done` is `true`.
    if (done) {
      const resultArray = new Uint8Array(totalRead);
      let offset = 0;
      for (const array of arrays) {
        resultArray.set(array, offset);
        offset += array.length;
      }
      return resultArray;
    }
    arrays.push(value);
    totalRead += value.length;
  }
}

export async function sandboxFetch(
  reqInfo: RequestInfo,
  options?: ProxyFetchRequest,
): Promise<ProxyFetchResponse> {
  if (typeof reqInfo !== "string") {
    const body = new Uint8Array(await reqInfo.arrayBuffer());
    const encodedBody = body.length > 0 ? base64Encode(body) : undefined;
    options = {
      method: reqInfo.method,
      headers: Object.fromEntries(reqInfo.headers.entries()),
      base64Body: encodedBody,
    };
    reqInfo = reqInfo.url;
  }
  // @ts-ignore: monkey patching fetch
  return syscall("sandboxFetch.fetch", reqInfo, options);
}

async function bodyInitToUint8Array(init: BodyInit): Promise<Uint8Array> {
  if (init instanceof Blob) {
    const buffer = await init.arrayBuffer();
    return new Uint8Array(buffer);
  } else if (init instanceof ArrayBuffer) {
    return new Uint8Array(init);
  } else if (init instanceof ReadableStream) {
    return readStream(init);
  } else if (typeof init === "string") {
    return new TextEncoder().encode(init);
  } else {
    throw new Error("Unknown body init type");
  }
}

export function monkeyPatchFetch() {
  // @ts-ignore: monkey patching fetch
  globalThis.nativeFetch = globalThis.fetch;
  // @ts-ignore: monkey patching fetch
  globalThis.fetch = async function (
    reqInfo: RequestInfo,
    init?: RequestInit,
  ): Promise<Response> {
    const encodedBody = init && init.body
      ? base64Encode(
        new Uint8Array(await (new Response(init.body)).arrayBuffer()),
      )
      : undefined;
    // console.log("Encoded this body", encodedBody);
    const r = await sandboxFetch(
      reqInfo,
      init && {
        method: init.method,
        headers: init.headers as Record<string, string>,
        base64Body: encodedBody,
      },
    );
    return new Response(r.base64Body ? base64Decode(r.base64Body) : null, {
      status: r.status,
      headers: r.headers,
    });
  };
}

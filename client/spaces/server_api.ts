import type { Client } from "../client.ts";
import { fsEndpoint } from "./constants.ts";

export class ServerError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

/** `<server base>/<endpoint>`, derived from the fs endpoint like every other server call. */
export function serverUrl(client: Client, endpoint: string): string {
  if (!client.httpSpacePrimitives) {
    throw new Error("This requires a connection to the server");
  }
  const base = client.httpSpacePrimitives.url.slice(0, -fsEndpoint.length);
  return `${base}/${endpoint}`;
}

/** GET without body, POST JSON with one; throws ServerError with the body's `message`/`error` on non-2xx. */
export async function serverJson<T>(
  client: Client,
  endpoint: string,
  opts: {
    body?: unknown;
    headers?: Record<string, string>;
    timeoutMs?: number;
  } = {},
): Promise<T> {
  const { body, headers, timeoutMs } = opts;
  const url = serverUrl(client, endpoint);
  const response = await client.httpSpacePrimitives.authenticatedFetch(
    url,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    timeoutMs,
  );
  const data: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const { error, message } = (data ?? {}) as {
      error?: unknown;
      message?: unknown;
    };
    const code = typeof error === "string" ? error : undefined;
    throw new ServerError(
      typeof message === "string"
        ? message
        : (code ?? `Server request failed (${response.status})`),
      response.status,
      code,
    );
  }
  return data as T;
}

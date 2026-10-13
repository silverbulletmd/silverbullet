import { describe, expect, it, vi } from "vitest";
import type { Client } from "../client.ts";
import { ServerError, serverJson, serverUrl } from "./server_api.ts";

function fakeClient(response: () => Response) {
  const authenticatedFetch = vi.fn(
    async (_url: string, _init: RequestInit, _timeout?: number) => response(),
  );
  const client = {
    httpSpacePrimitives: {
      url: "http://example.test/base/.fs",
      authenticatedFetch,
    },
  } as unknown as Client;
  return { client, authenticatedFetch };
}

describe("serverUrl", () => {
  it("derives the server base from the fs endpoint", () => {
    const { client } = fakeClient(() => new Response("{}"));
    expect(serverUrl(client, ".search/status")).toBe(
      "http://example.test/base/.search/status",
    );
  });

  it("requires a server connection", () => {
    const client = {} as Client;
    expect(() => serverUrl(client, ".search/status")).toThrow(
      "This requires a connection to the server",
    );
  });
});

describe("serverJson", () => {
  it("sends GET without a body", async () => {
    const { client, authenticatedFetch } = fakeClient(
      () => new Response(JSON.stringify({ ok: 1 })),
    );
    expect(
      await serverJson<{ ok: number }>(client, ".search/status", {
        headers: { "X-Test": "a" },
        timeoutMs: 3000,
      }),
    ).toEqual({ ok: 1 });
    const [url, init, timeout] = authenticatedFetch.mock.calls[0];
    expect(url).toBe("http://example.test/base/.search/status");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["X-Test"]).toBe("a");
    expect(timeout).toBe(3000);
  });

  it("sends POST JSON with a body", async () => {
    const { client, authenticatedFetch } = fakeClient(
      () => new Response(JSON.stringify({ items: [] })),
    );
    await serverJson(client, ".search/query", { body: { query: "garden" } });
    const [, init] = authenticatedFetch.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ query: "garden" }));
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
  });

  it("throws ServerError with status and code from the error body", async () => {
    const { client } = fakeClient(
      () =>
        new Response(
          JSON.stringify({
            error: "query-too-short",
            message: "Type at least 2 characters",
          }),
          { status: 400 },
        ),
    );
    const error = await serverJson(client, ".search/query", {
      body: { query: "g" },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ServerError);
    expect(error).toMatchObject({
      message: "Type at least 2 characters",
      status: 400,
      code: "query-too-short",
    });
  });

  it("falls back to the error code, then the status, for the message", async () => {
    const codeOnly = fakeClient(
      () =>
        new Response(JSON.stringify({ error: "unavailable" }), { status: 404 }),
    );
    await expect(
      serverJson(codeOnly.client, ".search/query", { body: {} }),
    ).rejects.toMatchObject({ message: "unavailable", status: 404 });
    const notJson = fakeClient(() => new Response("nope", { status: 403 }));
    await expect(
      serverJson(notJson.client, ".search/status"),
    ).rejects.toMatchObject({ status: 403, code: undefined });
  });
});

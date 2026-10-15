import { afterEach, expect, test, vi } from "vitest";
import type { Client } from "../client.ts";
import { createServerSearch } from "./server_search.ts";

afterEach(() => vi.useRealTimers());

function fakeClient() {
  const authenticatedFetch = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          backend: "fulltext",
          model: null,
          capabilities: { modes: ["words"], related: false },
          ready: true,
          progress: null,
          reason: null,
        }),
      ),
  );
  const client = {
    httpSpacePrimitives: {
      url: "http://example.test/.fs",
      authenticatedFetch,
    },
  } as unknown as Client;
  return { client, authenticatedFetch };
}

test("status calls close together share one request", async () => {
  vi.useFakeTimers();
  const { client, authenticatedFetch } = fakeClient();
  const search = createServerSearch(client, { hiddenPages: () => new Set() });

  const first = await search.status();
  const second = await search.status();
  expect(second).toEqual(first);
  expect(authenticatedFetch).toHaveBeenCalledTimes(1);

  await vi.advanceTimersByTimeAsync(1000);
  await search.status();
  expect(authenticatedFetch).toHaveBeenCalledTimes(2);
});

import { describe, expect, it, vi } from "vitest";
import type { Client } from "../../client.ts";
import type { ObjectIndex } from "../../data/object_index.ts";

type FetchFn = (
  url: string,
  init: RequestInit,
  timeout?: number,
) => Promise<Response>;

async function serverSearch(authenticatedFetch: FetchFn) {
  const { createServerSearch } = await import("../../search/server_search.ts");
  const client = {
    httpSpacePrimitives: {
      url: "http://example.test/.fs",
      authenticatedFetch,
    },
  } as unknown as Client;
  return createServerSearch(client, {} as ObjectIndex);
}

const errorResponse = (error: string, message: string) =>
  new Response(JSON.stringify({ error, message }), { status: 400 });

describe("find", () => {
  it("maps query-too-short to an empty result", async () => {
    const search = await serverSearch(async () =>
      errorResponse("query-too-short", "Type at least 2 characters"),
    );
    expect(await search.find("g")).toEqual({
      items: [],
      total: 0,
      partial: false,
      notice: null,
    });
  });

  it("rethrows other errors and passes results through", async () => {
    const failing = await serverSearch(async () =>
      errorResponse("bad-request", "boom"),
    );
    await expect(failing.find("garden")).rejects.toThrow("boom");
    const result = { items: [], total: 3, partial: true, notice: null };
    const working = await serverSearch(
      async () => new Response(JSON.stringify(result)),
    );
    expect(await working.find("garden", { scope: "all" })).toEqual(result);
  });
});

describe("module import", () => {
  it("does not need crypto.randomUUID (absent on insecure HTTP origins)", async () => {
    const real = globalThis.crypto;
    vi.resetModules();
    vi.stubGlobal("crypto", {
      getRandomValues: real.getRandomValues.bind(real),
    });
    try {
      await expect(
        import("../../search/server_search.ts"),
      ).resolves.toBeDefined();
      await expect(import("./search.ts")).resolves.toBeDefined();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("status", () => {
  it("uses a short fetch timeout", async () => {
    const fetch = vi.fn<FetchFn>(
      async () => new Response(JSON.stringify({ backend: "fulltext" })),
    );
    const search = await serverSearch(fetch);
    expect((await search.status()).backend).toBe("fulltext");
    expect(fetch.mock.calls[0][0]).toBe("http://example.test/.search/status");
    expect(fetch.mock.calls[0][2]).toBe(3000);
  });

  it("reports unavailable instead of throwing when the fetch fails", async () => {
    const search = await serverSearch(async () => {
      throw new Error("timed out");
    });
    const result = await search.status();
    expect(result.backend).toBeNull();
    expect(result.reason).toBe("timed out");
  });
});

describe("syscall registration", () => {
  it("registers the search syscalls and no search.rg", async () => {
    const { searchSyscalls } = await import("./search.ts");
    const search = await serverSearch(async () => new Response("{}"));
    expect(Object.keys(searchSyscalls(search)).sort()).toEqual([
      "search.find",
      "search.rank",
      "search.related",
      "search.status",
    ]);
  });
});

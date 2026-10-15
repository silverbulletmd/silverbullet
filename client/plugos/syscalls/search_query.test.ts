import { describe, expect, it, vi } from "vitest";
import type { Client } from "../../client.ts";
import type { PageMeta } from "../../../plug-api/types/index.ts";

type FetchFn = (
  url: string,
  init: RequestInit,
  timeout?: number,
) => Promise<Response>;

async function serverSearch(
  authenticatedFetch: FetchFn,
  allPages?: Partial<PageMeta>[],
) {
  const { createServerSearch } = await import("../../search/server_search.ts");
  const { hiddenPageNames } = await import("../../navigator/views/pages.ts");
  const client = {
    httpSpacePrimitives: {
      url: "http://example.test/.fs",
      authenticatedFetch,
    },
  } as unknown as Client;
  return createServerSearch(client, {
    hiddenPages: () => hiddenPageNames(allPages !== undefined, allPages ?? []),
  });
}

const match = (page: string) => ({
  page,
  pos: 0,
  line: 1,
  excerpt: "fern",
  highlights: [[0, 4]],
});

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

  it("sends the scope with the explicit lists instead of computing them", async () => {
    const fetch = vi.fn<FetchFn>(
      async () =>
        new Response(
          JSON.stringify({ items: [], total: 0, partial: false, notice: null }),
        ),
    );
    const search = await serverSearch(fetch, []);
    await search.find("fern", { scope: "meta", exclude: ["Templates/Daily"] });
    await search.find("fern", { scope: "pages", mode: "phrase", limit: 5 });
    await search.find("fern");
    const bodies = fetch.mock.calls.map(([url, init]) => {
      expect(url).toBe("http://example.test/.search/query");
      return JSON.parse(init.body as string);
    });
    expect(bodies).toEqual([
      { query: "fern", scope: "meta", exclude: ["Templates/Daily"] },
      { query: "fern", mode: "phrase", scope: "pages", limit: 5 },
      { query: "fern" },
    ]);
  });

  it("drops pages hidden by page decorations once the page list is loaded", async () => {
    const result = {
      items: [
        match("Garden"),
        match("Secret"),
        match("Secret"),
        match("Ferns"),
      ],
      total: 7,
      partial: false,
      notice: null,
    };
    const respond = async () => new Response(JSON.stringify(result));
    const pages = [
      { name: "Garden" },
      { name: "Secret", pageDecoration: { hide: true } },
      { name: "Ferns", pageDecoration: { hide: false } },
    ];
    const loaded = await serverSearch(respond, pages);
    const found = await loaded.find("fern", { scope: "pages" });
    expect(found.items.map((m) => m.page)).toEqual(["Garden", "Ferns"]);
    expect(found.total).toBe(6);
    // Before the index delivers the page list, results pass through.
    const early = await serverSearch(respond);
    expect(await early.find("fern", { scope: "pages" })).toEqual(result);
  });

  it("sends hidden pages in exclude, and leaves an explicit include alone", async () => {
    const result = {
      items: [match("Secret")],
      total: 1,
      partial: false,
      notice: null,
    };
    const fetch = vi.fn<FetchFn>(
      async () => new Response(JSON.stringify(result)),
    );
    const pages = [
      { name: "Garden" },
      { name: "Secret", pageDecoration: { hide: true } },
      { name: "Diary", pageDecoration: { hide: true } },
    ];
    const search = await serverSearch(fetch, pages);
    await search.find("fern");
    await search.find("fern", { scope: "meta", exclude: ["Garden", "Secret"] });
    // An explicit include: no exclude merge and no drop afterwards.
    const included = await search.find("fern", { include: ["Secret"] });
    expect(included).toEqual(result);
    const bodies = fetch.mock.calls.map(([, init]) =>
      JSON.parse(init.body as string),
    );
    expect(bodies).toEqual([
      { query: "fern", exclude: ["Secret", "Diary"] },
      { query: "fern", scope: "meta", exclude: ["Garden", "Secret", "Diary"] },
      { query: "fern", include: ["Secret"] },
    ]);
  });
});

describe("related", () => {
  it("sends hidden pages in exclude and drops them from the response", async () => {
    const result = {
      items: [match("Garden"), match("Secret")],
      total: 2,
      partial: false,
      notice: null,
    };
    const fetch = vi.fn<FetchFn>(
      async () => new Response(JSON.stringify(result)),
    );
    const pages = [
      { name: "Garden" },
      { name: "Secret", pageDecoration: { hide: true } },
    ];
    const search = await serverSearch(fetch, pages);
    const found = await search.related("Ferns", { limit: 5 });
    expect(found.items.map((m) => m.page)).toEqual(["Garden"]);
    expect(found.total).toBe(1);
    // Before the page list is loaded nothing is hidden.
    await (await serverSearch(fetch)).related("Ferns");
    const calls = fetch.mock.calls.map(([url, init]) => [
      url,
      JSON.parse(init.body as string),
    ]);
    await search.related("Basil", { limit: 3, scope: "pages" });
    expect(JSON.parse(fetch.mock.calls[2][1].body as string)).toEqual({
      page: "Basil",
      limit: 3,
      scope: "pages",
      exclude: ["Secret"],
    });
    expect(calls).toEqual([
      [
        "http://example.test/.search/related",
        { page: "Ferns", limit: 5, exclude: ["Secret"] },
      ],
      ["http://example.test/.search/related", { page: "Ferns" }],
    ]);
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

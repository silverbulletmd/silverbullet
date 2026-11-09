import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vitest";
import { collectTooling, type ToolingFile } from "./tooling.ts";
import { bootToolingCache, deleteToolingCaches } from "./tooling_cache.ts";
import {
  fetchTooling,
  resolveBootTooling,
  type Tooling,
  type ToolingCache,
} from "./tooling_fetch.ts";

const fixture: ToolingFile[] = JSON.parse(
  readFileSync(join(__dirname, "../testdata/tooling/expected.json"), "utf8"),
);

test("fetchTooling collects the payload's blocks in collectTooling order", async () => {
  const files: ToolingFile[] = [
    ...fixture,
    {
      path: "Library/Z.md",
      lastModified: 0,
      text: "```space-lua\n-- priority: 5\nz = 1\n```\n",
    },
  ];
  const requested: string[] = [];
  const fetchFn = (async (url: string) => {
    requested.push(url);
    return new Response(JSON.stringify(files));
  }) as typeof fetch;

  const tooling = await fetchTooling(fetchFn);

  expect(requested).toEqual([".tooling"]);
  expect(tooling.files).toEqual(files);
  expect(tooling.scripts.map((s) => s.ref)).toEqual([
    "Library/Z@0",
    "Library/Config@0",
  ]);
  expect(tooling).toEqual({ ...collectTooling(files), files });
});

test("fetchTooling rejects a failed response", async () => {
  const fetchFn = (async () =>
    new Response("nope", { status: 503 })) as unknown as typeof fetch;
  await expect(fetchTooling(fetchFn)).rejects.toThrow("503");
});

test("a stalled fetch gives up", async () => {
  // Accepts the request, then never answers until aborted
  const fetchFn = ((_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal!.reason),
      );
    })) as typeof fetch;

  await expect(fetchTooling(fetchFn, 20)).rejects.toThrow();
});

const fetched = (files: ToolingFile[]): Tooling => ({
  ...collectTooling(files),
  files,
});
const failed = new TypeError("Failed to fetch");

test("a failed fetch at boot with no cached copy boots without tooling", async () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect(await resolveBootTooling(failed, undefined)).toBeUndefined();
  expect(error).toHaveBeenCalledOnce();
  error.mockRestore();
});

function memoryCache(files?: ToolingFile[]) {
  const cache = {
    files,
    read: async () => cache.files,
    write: async (files: ToolingFile[]) => {
      cache.files = files;
    },
  };
  return cache satisfies ToolingCache;
}

test("a failed fetch at boot falls back to the cached payload", async () => {
  const cache = memoryCache(fixture);
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  expect(await resolveBootTooling(failed, cache)).toEqual(fetched(fixture));
  warn.mockRestore();
});

test("a good fetch at boot replaces the cached payload", async () => {
  const cache = memoryCache([]);

  expect((await resolveBootTooling(fetched(fixture), cache))?.files).toEqual(
    fixture,
  );
  expect(cache.files).toEqual(fixture);
});

/** Cache Storage that records which caches boot opens. */
function stubCaches(names: string[] = []) {
  const opened: string[] = [];
  const store = new Map(names.map((n) => [n, new Map<string, Response>()]));
  vi.stubGlobal("caches", {
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    open: async (name: string) => {
      opened.push(name);
      const entries = store.get(name) ?? new Map<string, Response>();
      store.set(name, entries);
      return {
        match: async (key: string) => entries.get(key)?.clone(),
        put: async (key: string, response: Response) => {
          entries.set(key, response);
        },
      };
    },
  });
  return { opened, names: () => [...store.keys()] };
}

test("with client encryption, boot neither writes nor reads the cache", async () => {
  const { opened } = stubCaches(["silverbullet.https://s/.tooling"]);
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    const cache = bootToolingCache(true, "https://s/");

    expect((await resolveBootTooling(fetched(fixture), cache))?.files).toEqual(
      fixture,
    );
    expect(await resolveBootTooling(failed, cache)).toBeUndefined();
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toEqual([]);

    await resolveBootTooling(
      fetched(fixture),
      bootToolingCache(false, "https://s/"),
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(opened).toEqual(["silverbullet.https://s/.tooling"]);
  } finally {
    error.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("deleteToolingCaches removes only tooling caches", async () => {
  const { names } = stubCaches([
    "silverbullet.https://a/.tooling",
    "silverbullet.https://b/.tooling",
    "sb-precache-1",
  ]);
  try {
    await deleteToolingCaches();
    expect(names()).toEqual(["sb-precache-1"]);
  } finally {
    vi.unstubAllGlobals();
  }
});

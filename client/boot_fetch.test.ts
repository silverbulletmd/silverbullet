import {
  notAuthenticatedError,
  offlineError,
} from "@silverbulletmd/silverbullet/constants";
import { expect, test, vi } from "vitest";
import { type BootFetchDeps, loadBootFiles } from "./boot_fetch.ts";

const PAGES = ["Std.md", "CONFIG.md"];
const CONFIG = '{"spaceFolderPath":"/space"}';

function setup(
  respond: (path: string) => Response | Error,
  cached: Record<string, string> = {},
) {
  const store = new Map(Object.entries(cached).map(([k, v]) => [`p.${k}`, v]));
  const deps: BootFetchDeps = {
    fetch: (async (path: string) => {
      const result = respond(path);
      if (result instanceof Error) throw result;
      return result;
    }) as typeof fetch,
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => void store.set(key, value),
    },
    cacheKeyPrefix: "p.",
    logoutInProgress: () => false,
    resetAndReload: vi.fn(async () => {}),
    navigate: vi.fn(),
  };
  const cache = (path: string) => store.get(`p.${path}`);
  return { deps, cache };
}

const allCached = {
  ".config": CONFIG,
  "Std.md": "std",
  "CONFIG.md": "mine",
};

test("a healthy boot returns and caches server copies, 404s as empty", async () => {
  const { deps, cache } = setup((path) =>
    path === "CONFIG.md"
      ? new Response("", { status: 404 })
      : new Response(path === ".config" ? CONFIG : "std"),
  );
  expect(await loadBootFiles(".config", PAGES, deps)).toEqual({
    configText: CONFIG,
    pageTexts: ["std", ""],
  });
  expect(cache(".config")).toBe(CONFIG);
  expect(cache("CONFIG.md")).toBe("");
});

test("a proxy 404 during a restart boots from the cache and keeps it", async () => {
  const { deps, cache } = setup(
    () => new Response("404 page not found", { status: 404 }),
    allCached,
  );
  expect(await loadBootFiles(".config", PAGES, deps)).toEqual({
    configText: CONFIG,
    pageTexts: ["std", "mine"],
  });
  expect(cache("Std.md")).toBe("std");
  expect(cache("CONFIG.md")).toBe("mine");
});

test("a non-JSON config response boots from the cache", async () => {
  const { deps } = setup(() => new Response("<html>Bad gateway</html>"), {
    ...allCached,
  });
  expect((await loadBootFiles(".config", PAGES, deps)).pageTexts).toEqual([
    "std",
    "mine",
  ]);
});

test("an unreachable server boots from the cache", async () => {
  const { deps } = setup(() => new TypeError("Failed to fetch"), allCached);
  expect((await loadBootFiles(".config", PAGES, deps)).configText).toBe(CONFIG);
});

test("no cache: a 404 reports the status, unreachable reports offline", async () => {
  await expect(
    loadBootFiles(
      ".config",
      PAGES,
      setup(() => new Response("", { status: 404 })).deps,
    ),
  ).rejects.toThrow("HTTP 404");
  await expect(
    loadBootFiles(
      ".config",
      PAGES,
      setup(() => new Response("", { status: 503 })).deps,
    ),
  ).rejects.toBe(offlineError);
});

test("an auth redirect navigates once and reports unauthenticated", async () => {
  const { deps } = setup(
    () => new Response(null, { status: 302, headers: { location: "/.auth" } }),
  );
  await expect(loadBootFiles(".config", PAGES, deps)).rejects.toBe(
    notAuthenticatedError,
  );
  expect(deps.navigate).toHaveBeenCalledTimes(1);
  expect(deps.navigate).toHaveBeenCalledWith("/.auth");
});

import { beforeEach, describe, expect, test } from "vitest";
import { ShareWorld, URI } from "./share_world_test_util.ts";

describe("Share.md status memo and web URLs", () => {
  let w: ShareWorld;

  beforeEach(async () => {
    w = await ShareWorld.create();
  });

  // Errors as strings: Lua error objects don't survive vitest's reporting
  const call = (fn: string, ...args: unknown[]) =>
    w.h.call(fn, ...args).catch((e) => `THREW ${e.message}`);

  test("status never transforms, and is computed once per text", async () => {
    let transforms = 0;
    w.h.services.push({
      id: "counter",
      selector: "share:transform",
      match: { name: "counter" },
      run: async () => {
        transforms++;
      },
    } as never);
    const define = (await w.h.call(
      "load",
      `hashes = 0
       local hash = share.legacyHash
       share.legacyHash = function(text)
         hashes = hashes + 1
         return hash(text)
       end`,
    )) as () => Promise<unknown>;
    await define();
    const hashes = () => w.h.env.get("hashes");
    await w.setup("A\n", "A\n", "A\n");
    const status = () => call("share.status", "Page");
    expect(await status()).toEqual({
      uri: URI,
      mode: "sync",
      state: "unchanged",
    });
    const counted = hashes();
    expect(await status()).toMatchObject({ state: "unchanged" });
    expect(hashes()).toBe(counted);
    w.pages.set("Page", `${w.pages.get("Page")}more\n`);
    expect(await status()).toMatchObject({ state: "localChanged" });
    expect(hashes()).toBeGreaterThan(counted);
    await w.setup("A\n", "A\n", "A\n", { mode: "push" });
    expect(await status()).toMatchObject({ state: "unchecked" });
    expect(transforms).toBe(0);
  });

  test("webUrl falls back to http URIs and nil", async () => {
    expect(await call("share.webUrl", "https://h/n/Page")).toBe(
      "https://h/n/Page",
    );
    expect(await call("share.webUrl", "test://other/Page.md")).toBeNull();
  });

  test("gitBlobSha hashes text as a git blob, by UTF-8 byte length", async () => {
    expect(await call("share.gitBlobSha", "hello\n")).toBe(
      "ce013625030ba8dba906f756967f9e9ca394464a",
    );
    expect(await call("share.gitBlobSha", "é\n")).toBe(
      "c6003325155f475bd7c87731607525dce73be9cf",
    );
    expect(await call("share.gitBlobSha", "")).toBe(
      "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391",
    );
    // 3- and 4-byte characters (the latter a UTF-16 surrogate pair)
    expect(await call("share.gitBlobSha", "a€😀\n")).toBe(
      "619e2b18b1b1d3fd6f66da74d851340c1a862f17",
    );
  });
});

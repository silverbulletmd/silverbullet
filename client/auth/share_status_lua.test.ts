import { beforeEach, describe, expect, test } from "vitest";
import { ShareWorld, URI } from "./share_world_test_util.ts";

describe("Share.md status engine", () => {
  let w: ShareWorld;

  beforeEach(async () => {
    w = await ShareWorld.create();
  });

  const status = () => w.h.call("share.status", "Page");
  const check = async () =>
    ((await w.h.call("share.check", ["Page"])) as Record<string, any>).Page;

  describe("status", () => {
    test("unchanged when the outgoing text is the base", async () => {
      await w.setup("A\n", "A\n", "A\n", { mode: "push" });
      expect(await status()).toEqual({
        uri: URI,
        mode: "push",
        state: "unchanged",
      });
    });

    test("localChanged when it differs from the base", async () => {
      await w.setup("A\n", "B\n", "A\n", { mode: "pull" });
      expect(await status()).toEqual({
        uri: URI,
        mode: "pull",
        state: "localChanged",
      });
    });

    test("compares the transformed text for push", async () => {
      await w.setup("A\n", "A<!-- note -->\n", "A\n", { mode: "push" });
      expect(((await status()) as any).state).toBe("unchanged");
    });

    test("unknown without a base or hint", async () => {
      await w.setup("A\n", "A\n", "A\n", { storeBase: false });
      expect(((await status()) as any).state).toBe("unknown");
    });

    test("an unchanged legacy hash stands for the base", async () => {
      await w.setup("A\n", "A\n", "A\n", {
        storeBase: false,
        legacyHash: true,
      });
      expect(((await status()) as any).state).toBe("unchanged");
    });

    test("a legacy hash that no longer matches gives no baseline", async () => {
      await w.setup("A\n", "B\n", "A\n", {
        storeBase: false,
        legacyHash: true,
      });
      expect(((await status()) as any).state).toBe("unknown");
    });

    test("a push hint does not count when the transform changed the text", async () => {
      await w.setup("A\n", "A<!-- note -->\n", "A\n", {
        mode: "push",
        storeBase: false,
        legacyHash: true,
      });
      expect(((await status()) as any).state).toBe("unknown");
    });
  });

  describe("check", () => {
    test("upToDate when the remote is the outgoing text", async () => {
      await w.setup("A\n", "B\n", "B\n");
      expect(await check()).toEqual({
        uri: URI,
        mode: "sync",
        state: "upToDate",
      });
    });

    test("localChanged when only the page changed", async () => {
      await w.setup("A\n", "B\n", "A\n");
      expect((await check()).state).toBe("localChanged");
    });

    test("remoteChanged when only the remote changed", async () => {
      await w.setup("A\n", "A\n", "C\n");
      expect((await check()).state).toBe("remoteChanged");
    });

    test("bothChanged", async () => {
      await w.setup("A\n", "B\n", "C\n");
      expect((await check()).state).toBe("bothChanged");
    });

    test("differs without a base or hint", async () => {
      await w.setup("A\n", "B\n", "C\n", { storeBase: false });
      expect((await check()).state).toBe("differs");
    });

    test("an unchanged legacy hash with a different remote is remoteChanged", async () => {
      await w.setup("A\n", "A\n", "C\n", {
        storeBase: false,
        legacyHash: true,
      });
      expect((await check()).state).toBe("remoteChanged");
    });

    test("a remote's own share keys are ignored", async () => {
      const body = "---\nx: 1\n---\nA\n";
      await w.setup(body, body, "---\nx: 1\nshare.uri: y\n---\nA\n");
      expect((await check()).state).toBe("upToDate");
    });

    test("missing when the remote has no page", async () => {
      await w.setup("A\n", "A\n", "A\n");
      w.remote.delete("Page");
      expect((await check()).state).toBe("missing");
    });

    test("error when the read throws, without connecting or prompting", async () => {
      await w.setup("A\n", "A\n", "A\n");
      await w.newDevice();
      const result = await check();
      expect(result.state).toBe("error");
      expect(typeof result.error).toBe("string");
      expect(w.deviceFlows).toEqual([]);
      expect(w.confirms).toEqual([]);
    });

    test("an unconfigured page is an error", async () => {
      w.pages.set("Page", "Plain\n");
      const result = await check();
      expect(result.state).toBe("error");
      expect(result.error).toContain("Not configured");
    });

    test("only reads: no fetch other than GET, no writes", async () => {
      await w.setup("A\n", "B\n", "C\n");
      const before = w.pages.get("Page");
      await check();
      expect(w.methods().every((m) => m === "GET")).toBe(true);
      expect(w.pages.get("Page")).toBe(before);
      expect(w.store.get(`share.base:${URI}`)).toBe("A\n");
      expect(w.remote.get("Page")!.text).toBe("C\n");
    });
  });

  describe("shareMany", () => {
    async function twoPages() {
      await w.setup("A\n", "A2\n", "A\n", { mode: "push" });
      // B is not configured, so sharing it throws
      w.pages.set("B", "Plain\n");
    }

    test("continues past an error and reports progress", async () => {
      await twoPages();
      // Make A the failing one instead: B first would also work
      const progress: unknown[][] = [];
      const results = (await w.h.call("share.shareMany", ["B", "Page"], {
        onProgress: (...args: unknown[]) => progress.push(args),
      })) as Record<string, any>;
      expect(progress).toEqual([
        [1, 2, "B"],
        [2, 2, "Page"],
      ]);
      expect(results.B.ok).toBe(false);
      expect(results.B.error).toContain("Not configured");
      expect(results.Page).toEqual({ ok: true, result: true });
      expect(w.remote.get("Page")!.text).toBe("A2\n");
    });

    test("reports false when there is nothing to share", async () => {
      await w.setup("A\n", "A\n", "A\n", { mode: "push" });
      const results = (await w.h.call("share.shareMany", ["Page"])) as any;
      expect(results.Page).toEqual({ ok: true, result: false });
    });

    test("stops when cancelled, leaving the rest out", async () => {
      await twoPages();
      w.pages.set("C", "Plain\n");
      let calls = 0;
      const results = (await w.h.call("share.shareMany", ["Page", "B", "C"], {
        cancelled: () => calls++ >= 1,
      })) as Record<string, unknown>;
      expect(Object.keys(results)).toEqual(["Page"]);
    });
  });

  test("check: a remote still at the legacy hash means only local changed", async () => {
    await w.setup("A\n", "B\n", "A\n", { storeBase: false, legacyHash: true });
    expect(((await check()) as any).state).toBe("localChanged");
  });
});

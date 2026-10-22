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
    test("unchanged when the page is what its share.hash describes", async () => {
      await w.setup("A\n", "A\n", "B\n", { mode: "pull" });
      expect(await status()).toEqual({
        uri: URI,
        mode: "pull",
        state: "unchanged",
      });
    });

    test("localChanged when the page no longer matches its share.hash", async () => {
      await w.setup("A\n", "B\n", "A\n");
      expect(await status()).toEqual({
        uri: URI,
        mode: "sync",
        state: "localChanged",
      });
    });

    test("unknown without a share.hash", async () => {
      await w.setup("A\n", "A\n", "A\n", { hash: false });
      expect(((await status()) as any).state).toBe("unknown");
    });

    test("push is unchecked: nothing to compare with offline", async () => {
      await w.setup("A\n", "A\n", "A\n", { mode: "push" });
      expect(await status()).toEqual({
        uri: URI,
        mode: "push",
        state: "unchecked",
      });
      await w.setup("A\n", "B\n", "A\n", { mode: "push", hash: false });
      expect(((await status()) as any).state).toBe("unchecked");
      // Offline: not even a read
      expect(w.fetches).toEqual([]);
    });

    test("a caller changing the result leaves the memo alone", async () => {
      await w.setup("A\n", "A\n", "A\n");
      const define = (await w.h.call(
        "load",
        `function tamperedStatus()
           share.status("Page").state = "tampered"
           return share.status("Page")
         end`,
      )) as () => Promise<unknown>;
      await define();
      expect(
        await w.h.call("tamperedStatus").catch((e) => `THREW ${e.message}`),
      ).toEqual({ uri: URI, mode: "sync", state: "unchanged" });
    });

    test("an unconfigured page is an error", async () => {
      w.pages.set("Page", "Plain\n");
      expect(
        await w.h
          .call("share.status", "Page")
          .catch((e) => `THREW ${e.message}`),
      ).toContain("Not configured");
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

    test("differs without a share.hash", async () => {
      await w.setup("A\n", "B\n", "C\n", { hash: false });
      expect((await check()).state).toBe("differs");
    });

    test("push differs or is upToDate, whatever its share.hash", async () => {
      // A share.hash older versions wrote for push says nothing
      await w.setup("A\n", "B\n", "A\n", { mode: "push" });
      expect((await check()).state).toBe("differs");
      await w.setup("A\n", "B\n", "B\n", { mode: "push" });
      expect((await check()).state).toBe("upToDate");
      w.remote.delete("Page");
      expect((await check()).state).toBe("missing");
    });

    test("push compares the transformed text", async () => {
      await w.setup("A\n", "A<!-- note -->\n", "A\n", { mode: "push" });
      expect((await check()).state).toBe("upToDate");
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
      expect(w.store.size).toBe(1); // just the credential
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
});

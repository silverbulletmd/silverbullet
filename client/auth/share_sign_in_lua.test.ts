import { beforeEach, describe, expect, test } from "vitest";
import { FS, ShareWorld, SPACE, URI } from "./share_world_test_util.ts";

describe("Share.md signing in to SilverBullet spaces", () => {
  let w: ShareWorld;

  beforeEach(async () => {
    w = await ShareWorld.create();
  });

  test("connects on demand for an unconnected SilverBullet URI", async () => {
    w.store = new Map();
    w.h = await w.load();
    await w.setup("A\n", "B\n", "A\n", { mode: "push" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.confirms).toEqual([`Connect to ${SPACE}?`]);
    expect(w.deviceFlows).toHaveLength(1);
    expect(w.configWrites).toEqual([
      { path: "share.silverbullet.spaces", value: [SPACE] },
    ]);
    const put = w.fetches.find((f) => f.opts?.method === "PUT")!;
    expect(put.url).toBe(FS);
    expect(put.opts.headers.Authorization).toBe("Bearer access1");
    // Push does no read first, so no If-Match
    expect(put.opts.headers["If-Match"]).toBeUndefined();
    expect(w.remote.get("Page")!.text).toBe("B\n");
    expect(w.store.get(`share.base:${URI}`)).toBe("B\n");
  });

  test("a space from config works on a new device, whatever the load order", async () => {
    // New device: no credential, and CONFIG's config.set runs after the pages
    w.store = new Map();
    w.h = await w.load();
    w.cfg["share.silverbullet.spaces"] = [SPACE];
    // The generic https: reader would return the server-rendered page
    w.genericReads.set(URI, "<html>Sign in</html>");

    await w.setup("A\n", "B\n", "A\n", { mode: "push", storeBase: false });
    expect(
      await w.h
        .call("share.sharePage", "Page")
        .catch((e) => `THREW ${e.message}`),
    ).toBe(true);
    expect(w.remote.get("Page")!.text).toBe("B\n");
    // Signs in after asking once; the space is known, so nothing is probed
    expect(w.deviceFlows).toHaveLength(1);
    expect(w.confirms).toEqual([`Sign in to ${SPACE}?`]);
    expect(w.fetches.some((f) => f.url.endsWith("/.ping"))).toBe(false);

    await w.setup("A\n", "A\n", "C\n", { mode: "sync" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(await w.localBody()).toBe("C\n");
    expect(w.genericReadCount).toBe(0);
    expect(w.fetches.every((f) => f.url.startsWith(`${SPACE}/.fs/`))).toBe(
      true,
    );
    // Connected now: no second sign-in
    expect(w.deviceFlows).toHaveLength(1);
    expect(w.confirms).toHaveLength(1);
  });

  test("declining to connect stops the share and leaves the page alone", async () => {
    for (const mode of ["push", "sync"]) {
      w.store = new Map();
      w.configWrites = [];
      w.h = await w.load();
      w.genericReads.set(URI, "<html>Sign in</html>");
      w.confirmAnswer = false;
      await w.setup("A\n", "B\n", "C\n", { mode, storeBase: false });
      const before = w.pages.get("Page");
      await expect(w.h.call("share.sharePage", "Page"), mode).rejects.toThrow(
        `Not connected to ${SPACE}`,
      );
      expect(w.pages.get("Page"), mode).toBe(before);
      expect(w.remote.get("Page")!.text, mode).toBe("C\n");
      expect(w.genericReadCount, mode).toBe(0);
      expect(w.deviceFlows, mode).toHaveLength(0);
      expect(w.configWrites, mode).toEqual([]);
    }
  });

  test("a failed sign-in stops the share too", async () => {
    w.store = new Map();
    w.h = await w.load();
    w.genericReads.set(URI, "<html>Sign in</html>");
    w.deviceFlowError = "cancelled: Sign-in cancelled";
    await w.setup("A\n", "A\n", "C\n", { storeBase: false });
    const before = w.pages.get("Page");
    await expect(w.h.call("share.sharePage", "Page")).rejects.toThrow(
      `Not connected to ${SPACE}`,
    );
    expect(w.pages.get("Page")).toBe(before);
    expect(w.genericReadCount).toBe(0);
  });

  test("pulls from a public space anonymously, without signing in", async () => {
    w.store = new Map();
    w.cfg["share.silverbullet.spaces"] = [SPACE];
    w.h = await w.load();
    await w.setup("A\n", "A\n", "C\n", { mode: "pull", storeBase: false });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(await w.localBody()).toBe("C\n");
    expect(w.fetches.map((f) => f.url)).toEqual([FS]);
    expect(w.fetches[0].opts.headers?.Authorization).toBeUndefined();
    expect(w.deviceFlows).toEqual([]);
  });

  test("sync on a new device signs in once, then syncs", async () => {
    await w.newDevice();
    await w.setup("A\n", "A\n", "C\n", {
      mode: "sync",
      storeBase: false,
      legacyHash: true,
    });
    expect(await w.sharePage()).toBe(true);
    expect(w.confirms).toEqual([`Sign in to ${SPACE}?`]);
    expect(w.deviceFlows).toHaveLength(1);
    // Signed in before the first read: no anonymous request, no 401
    expect(w.fetches.map((f) => f.opts.headers?.Authorization)).toEqual([
      "Bearer access1",
    ]);
    expect(await w.localBody()).toBe("C\n");
    expect(w.genericReadCount).toBe(0);

    // A later sync uses the stored credential without asking
    w.setRemote("Page", "D\n");
    expect(await w.sharePage()).toBe(true);
    expect(await w.localBody()).toBe("D\n");
    expect(w.confirms).toHaveLength(1);
    expect(w.deviceFlows).toHaveLength(1);
  });

  test("push on a new device signs in before writing", async () => {
    await w.newDevice();
    await w.setup("A\n", "B\n", "A\n", { mode: "push", storeBase: false });
    expect(await w.sharePage()).toBe(true);
    expect(w.confirms).toEqual([`Sign in to ${SPACE}?`]);
    expect(w.deviceFlows).toHaveLength(1);
    // Without a base the push compares with the remote first
    expect(w.methods()).toEqual(["GET", "PUT"]);
    expect(w.fetches.map((f) => f.opts.headers.Authorization)).toEqual([
      "Bearer access1",
      "Bearer access1",
    ]);
    expect(w.fetches[1].opts.headers["If-Match"]).toBeUndefined();
    expect(w.remote.get("Page")!.text).toBe("B\n");
  });

  test("a push without local changes on a new device doesn't ask to sign in", async () => {
    await w.newDevice();
    await w.setup("A\n", "A\n", "A\n", {
      mode: "push",
      storeBase: false,
      legacyHash: true,
    });
    expect(await w.sharePage()).toBe(false);
    expect(w.confirms).toEqual([]);
    expect(w.deviceFlows).toHaveLength(0);
    expect(w.fetches).toEqual([]);
  });

  test("declining to sign in on a new device leaves page and remote alone", async () => {
    for (const mode of ["push", "sync"]) {
      await w.newDevice();
      w.fetches = [];
      w.confirms = [];
      w.confirmAnswer = false;
      await w.setup("A\n", "B\n", "C\n", { mode, storeBase: false });
      const before = w.pages.get("Page");
      const err = String(await w.sharePage());
      expect(err, mode).toContain(`Not connected to ${SPACE}`);
      expect(err, mode).not.toContain("to sign in");
      expect(w.confirms, mode).toEqual([`Sign in to ${SPACE}?`]);
      expect(w.pages.get("Page"), mode).toBe(before);
      expect(w.remote.get("Page")!.text, mode).toBe("C\n");
      expect(w.fetches, mode).toEqual([]);
      expect(w.deviceFlows, mode).toHaveLength(0);
      expect(w.stored(), mode).toBeUndefined();
    }
  });

  test("an expired credential that can't be refreshed asks to sign in first", async () => {
    for (const mode of ["push", "sync"]) {
      await w.newDevice();
      w.fetches = [];
      w.confirms = [];
      w.deviceFlows = [];
      // Expired; refreshing it fails (the fake space has no token endpoint)
      w.expiredCredential();
      await w.setup("A\n", "B\n", "A\n", { mode, storeBase: false });
      // Sync can't tell which side changed without a base
      w.chooseAnswer = "mine";
      expect(await w.sharePage(), mode).toBe(true);
      expect(w.confirms, mode).toEqual([`Sign in to ${SPACE}?`]);
      expect(w.deviceFlows, mode).toHaveLength(1);
      // No anonymous (or stale-token) request to the private space
      const fsRequests = w.fetches.filter((f) => f.url.includes("/.fs/"));
      expect(
        fsRequests.map((f) => f.opts.headers?.Authorization),
        mode,
      ).toEqual(fsRequests.map(() => "Bearer access1"));
      expect(w.remote.get("Page")!.text, mode).toBe("B\n");
    }
  });

  test("deciding whether to sign in makes no requests", async () => {
    await w.newDevice();
    w.refreshWorks = true;
    w.expiredCredential();
    const matches = (await w.h.call("service.discover", "share:ensure", {
      uri: URI,
    })) as unknown[];
    expect(matches).toHaveLength(1);
    expect(w.fetches).toEqual([]);
    expect(w.stored().access_token).toBe("old");
  });

  test("an expired credential that can be refreshed is, without asking", async () => {
    for (const mode of ["push", "sync"]) {
      await w.newDevice();
      w.fetches = [];
      w.confirms = [];
      w.deviceFlows = [];
      w.refreshWorks = true;
      w.expiredCredential();
      await w.setup("A\n", "B\n", "A\n", { mode, storeBase: false });
      // Sync can't tell which side changed without a base
      w.chooseAnswer = "mine";
      expect(await w.sharePage(), mode).toBe(true);
      expect(w.confirms, mode).toEqual([]);
      expect(w.deviceFlows, mode).toHaveLength(0);
      const fsRequests = w.fetches.filter((f) => f.url.includes("/.fs/"));
      expect(
        fsRequests.map((f) => f.opts.headers?.Authorization),
        mode,
      ).toEqual(fsRequests.map(() => "Bearer refreshed"));
      expect(w.remote.get("Page")!.text, mode).toBe("B\n");
    }
  });

  test("a pull from the same space stays anonymous and never prompts", async () => {
    await w.newDevice();
    w.requireAuth = false;
    await w.setup("A\n", "A\n", "C\n", {
      mode: "pull",
      storeBase: false,
      legacyHash: true,
    });
    expect(await w.sharePage()).toBe(true);
    expect(await w.localBody()).toBe("C\n");
    expect(w.fetches[0].opts.headers?.Authorization).toBeUndefined();
    expect(w.confirms).toEqual([]);
    expect(w.deviceFlows).toEqual([]);
  });

  test("a pull that needs a token asks to share instead of signing in", async () => {
    await w.newDevice();
    await w.setup("A\n", "A\n", "C\n", { mode: "pull", storeBase: false });
    await expect(w.h.call("share.sharePage", "Page")).rejects.toThrow(
      `Not connected to ${SPACE}: share a page to it in push or sync mode to sign in`,
    );
    expect(w.confirms).toEqual([]);
    expect(w.deviceFlows).toEqual([]);
    expect(w.genericReadCount).toBe(0);
  });

  test("a cancelled sign-in during onboarding is reported", async () => {
    w.store = new Map();
    w.cfg["share.silverbullet.spaces"] = [SPACE];
    w.h = await w.load();
    w.deviceFlowError = "cancelled: Sign-in cancelled";
    w.editorText = "Hello\n";
    const r = await w.h.commands.get("Share: Page")!().catch(
      (e) => `THREW ${e.message}`,
    );
    expect(r).toBeUndefined();
    expect(w.notifications).toHaveLength(1);
    expect(w.notifications[0][0]).toMatch(/^Error: .*cancelled/);
    expect(w.notifications[0][1]).toBe("error");
    expect(w.editorText).toBe("Hello\n");
    expect(w.remote.has("Page")).toBe(false);
  });
});

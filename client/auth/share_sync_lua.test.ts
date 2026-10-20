import { beforeEach, describe, expect, test } from "vitest";
import { extractFrontMatter } from "../../plugs/index/frontmatter.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import {
  FS,
  OTHER,
  SPACE,
  ShareWorld,
  sha256,
  URI,
} from "./share_world_test_util.ts";

describe("Share.md sharing", () => {
  let w: ShareWorld;

  beforeEach(async () => {
    w = await ShareWorld.create();
  });

  test("Share: Page onboarding to a SilverBullet space uploads the page", async () => {
    w.cfg["share.silverbullet.spaces"] = [SPACE];
    w.editorText = "Hello\n";
    await w.h.commands.get("Share: Page")!();
    expect(w.remote.get("Page")!.text).toBe("Hello\n");
    expect(extractFrontMatter(parseMarkdown(w.editorText)).share).toMatchObject(
      {
        uri: URI,
        mode: "push",
      },
    );
    expect(w.notifications).toEqual([["Share complete!", undefined]]);
    expect(w.store.get(`share.base:${URI}`)).toBe("Hello\n");
    // Already in sync: a later share has nothing to push
    const before = w.fetches.length;
    w.pages.set("Page", w.editorText);
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.fetches.length).toBe(before);
  });

  test("pushes when only local changed and records the base text", async () => {
    await w.setup("A\n", "B\n", "A\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.remote.get("Page")!.text).toBe("B\n");
    expect(w.store.get(`share.base:${URI}`)).toBe("B\n");
    expect(w.localShare().hash).toBe(
      await w.h.call("share.contentHash", "B\n"),
    );
  });

  test("pulls when only remote changed", async () => {
    await w.setup("A\n", "A\n", "C\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(await w.localBody()).toBe("C\n");
    expect(w.store.get(`share.base:${URI}`)).toBe("C\n");
    expect(w.localShare().hash).toBe(
      await w.h.call("share.contentHash", "C\n"),
    );
    expect(w.methods()).toEqual(["GET"]);
  });

  test("sync merges through space.mergeText for any provider", async () => {
    const base = "A\n";
    const hash = await w.h.call("share.contentHash", base);
    w.pages.set(
      "Page",
      (await w.h.call(
        "share.setFrontmatter",
        { uri: OTHER, hash, mode: "sync" },
        "B\n",
      )) as string,
    );
    w.other.set(OTHER, "C\n");
    w.store.set(`share.base:${OTHER}`, base);
    w.mergeText = () => ({ status: "clean", text: "M\n" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.merges).toEqual([["A\n", "B\n", "C\n"]]);
    expect(await w.localBody()).toBe("M\n");
    expect(w.localShare()).toEqual({
      uri: OTHER,
      mode: "sync",
      hash: await w.h.call("share.contentHash", "M\n"),
    });
    expect(w.other.get(OTHER)).toBe("M\n");
    expect(w.store.get(`share.base:${OTHER}`)).toBe("M\n");
    expect(w.notifications).toEqual([]);
    // No SilverBullet requests (nor space probes)
    expect(w.fetches).toEqual([]);
  });

  test("merges cleanly with a SilverBullet space and pushes with If-Match", async () => {
    await w.setup("A\n", "B\n", "C\n");
    w.mergeText = () => ({ status: "clean", text: "M\n" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.merges).toEqual([["A\n", "B\n", "C\n"]]);
    expect(w.methods()).toEqual(["GET", "PUT"]);
    expect(w.fetches[1].opts.headers["If-Match"]).toBe('"e1"');
    expect(w.remote.get("Page")!.text).toBe("M\n");
    expect(await w.localBody()).toBe("M\n");
    expect(w.store.get(`share.base:${URI}`)).toBe("M\n");
  });

  test("conflicted merge writes markers on both sides", async () => {
    await w.setup("A\n", "B\n", "C\n");
    const marked = "<<<<<<< local\nB\n=======\nC\n>>>>>>> remote\n";
    w.mergeText = () => ({ status: "conflicted", text: marked });
    await w.h.call("share.sharePage", "Page");
    expect(await w.localBody()).toBe(marked);
    expect(w.remote.get("Page")!.text).toBe(marked);
    expect(w.localShare().hash).toBe(
      await w.h.call("share.contentHash", marked),
    );
    expect(w.store.get(`share.base:${URI}`)).toBe(marked);
    expect(w.notifications).toContainEqual([
      "Merged with conflicts — resolve the markers, then share again",
      "error",
    ]);
  });

  test("falls back to a conflict copy without base text", async () => {
    const hash = await w.setup("A\n", "B\n", "C\n", { storeBase: false });
    const before = w.pages.get("Page");
    await w.h.call("share.sharePage", "Page");
    const copy = `Page.conflicted-${sha256("C\n").slice(0, 8)}`;
    expect(w.merges).toEqual([]);
    expect(w.pages.get(copy)).toBe("C\n");
    expect(w.pages.get("Page")).toBe(before);
    expect(w.localShare().hash).toBe(hash);
    expect(w.store.has(`share.base:${URI}`)).toBe(false);
    expect(w.methods()).toEqual(["GET"]);
    expect(w.notifications).toContainEqual([
      `Conflict: remote copy saved as ${copy}`,
      "error",
    ]);
  });

  test("unmergeable inputs fall back to a conflict copy", async () => {
    const hash = await w.setup("A\n", "B\n", "C\n");
    const before = w.pages.get("Page");
    w.mergeText = () => null;
    await w.h.call("share.sharePage", "Page");
    expect(w.merges).toHaveLength(1);
    expect(w.methods()).toEqual(["GET"]);
    const copy = `Page.conflicted-${sha256("C\n").slice(0, 8)}`;
    expect(w.pages.get(copy)).toBe("C\n");
    expect(w.pages.get("Page")).toBe(before);
    expect(w.remote.get("Page")!.text).toBe("C\n");
    expect(w.localShare().hash).toBe(hash);
    expect(w.store.get(`share.base:${URI}`)).toBe("A\n");
  });

  test("retries once when the write hits a 412", async () => {
    await w.setup("A\n", "B\n", "A\n");
    // Someone else writes between our read and our write
    w.beforePut = () => {
      w.beforePut = undefined;
      w.setRemote("Page", "C\n");
    };
    w.mergeText = (base) => ({ status: "clean", text: `merged:${base}` });
    await w.h.call("share.sharePage", "Page");
    expect(w.methods()).toEqual(["GET", "PUT", "GET", "PUT"]);
    expect(w.fetches[1].opts.headers["If-Match"]).toBe('"e1"');
    expect(w.merges).toEqual([["A\n", "B\n", "C\n"]]);
    expect(await w.localBody()).toBe("merged:A\n");
    expect(w.remote.get("Page")!.text).toBe("merged:A\n");
  });

  test("retries once when the merged write hits a 412", async () => {
    await w.setup("A\n", "B\n", "C\n");
    w.beforePut = () => {
      w.beforePut = undefined;
      w.setRemote("Page", "D\n");
    };
    w.mergeText = (_base, _local, remoteText) => ({
      status: "clean",
      text: `merged:${remoteText}`,
    });
    await w.h.call("share.sharePage", "Page");
    expect(w.methods()).toEqual(["GET", "PUT", "GET", "PUT"]);
    expect(w.merges.map((m) => m[2])).toEqual(["C\n", "D\n"]);
    expect(w.remote.get("Page")!.text).toBe("merged:D\n");
    expect(await w.localBody()).toBe("merged:D\n");
  });

  test("a base from before another device shared the page is not used", async () => {
    // This device recorded A, then another device shared B (synced share.hash)
    await w.setup("B\n", "C\n", "D\n");
    w.store.set(`share.base:${URI}`, "A\n");
    w.mergeText = () => ({ status: "clean", text: "M\n" });
    await w.h.call("share.sharePage", "Page");
    expect(w.merges).toEqual([]);
    expect(w.pages.get(`Page.conflicted-${sha256("D\n").slice(0, 8)}`)).toBe(
      "D\n",
    );
    expect(w.remote.get("Page")!.text).toBe("D\n");
  });

  test("gives up when the remote keeps changing", async () => {
    await w.setup("A\n", "B\n", "A\n");
    w.beforePut = () => w.setRemote("Page", `R${w.etagCounter}\n`);
    w.mergeText = () => ({ status: "clean", text: "M\n" });
    const before = w.pages.get("Page");
    await expect(w.h.call("share.sharePage", "Page")).rejects.toThrow(
      /remote changed again/,
    );
    expect(w.methods()).toEqual(["GET", "PUT", "GET", "PUT"]);
    expect(w.pages.get("Page")).toBe(before);
  });

  test("onboarding that already uploaded needs no push", async () => {
    w.h.services.push({
      selector: "share:onboard",
      match: { name: "Uploads itself" },
      run: async (data: any) => {
        w.other.set(OTHER, "Hello\n");
        return {
          uri: OTHER,
          mode: "push",
          hash: await w.h.call("share.contentHash", data.text),
        };
      },
      id: "uploads-itself",
    });
    w.editorText = "Hello\n";
    w.shareProvider = "Uploads itself";
    await w.h.commands.get("Share: Page")!();
    expect(w.notifications).toEqual([["Share complete!", undefined]]);
    expect(extractFrontMatter(parseMarkdown(w.editorText)).share).toMatchObject(
      {
        uri: OTHER,
        mode: "push",
      },
    );
    expect(w.fetches).toEqual([]);
  });

  test("library pulls never probe or prompt", async () => {
    const lib = "https://raw.githubusercontent.com/u/r/main/Lib.md";
    const hash = await w.h.call("share.contentHash", "v1\n");
    w.pages.set(
      "Page",
      (await w.h.call(
        "share.setFrontmatter",
        { uri: lib, hash, mode: "pull" },
        "v1\n",
      )) as string,
    );
    w.genericReads.set(lib, "v2\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    // No space probes (or any other request through the proxy)
    expect(w.fetches.map((f) => f.url)).toEqual([]);
    expect(w.confirms).toEqual([]);
    expect(await w.localBody()).toBe("v2\n");
    // Base text only matters for sync
    expect(w.store.has(`share.base:${lib}`)).toBe(false);
  });

  test("a pull from a known space uses its transport", async () => {
    await w.setup("A\n", "A\n", "C\n", { mode: "pull", storeBase: false });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.fetches.map((f) => f.url)).toEqual([FS]);
    expect(w.fetches[0].opts.headers.Authorization).toBe("Bearer token");
    expect(await w.localBody()).toBe("C\n");
    expect(w.store.has(`share.base:${URI}`)).toBe(false);
  });

  test("push overwrites a remote edited since the last push", async () => {
    await w.setup("A\n", "B\n", "A\n", { mode: "push" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    // Edited remotely, then locally
    w.setRemote("Page", "R\n");
    w.pages.set(
      "Page",
      (await w.h.call("share.setFrontmatter", w.localShare(), "D\n")) as string,
    );
    const r = await w.h
      .call("share.sharePage", "Page")
      .catch((e) => `THREW ${e.message}`);
    expect(r).toBe(true);
    expect(w.remote.get("Page")!.text).toBe("D\n");
    for (const put of w.fetches.filter((f) => f.opts?.method === "PUT")) {
      expect(put.opts.headers["If-Match"]).toBeUndefined();
    }
  });
});

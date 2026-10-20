import { beforeEach, describe, expect, test } from "vitest";
import { extractFrontMatter } from "../../plugs/index/frontmatter.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import {
  FS,
  OTHER,
  ShareWorld,
  SPACE,
  sha256,
  URI,
} from "./share_world_test_util.ts";

describe("Share.md sharing", () => {
  let w: ShareWorld;

  beforeEach(async () => {
    w = await ShareWorld.create();
  });

  async function setPage(m: Record<string, unknown>, body: string) {
    w.pages.set(
      "Page",
      (await w.h.call("share.setFrontmatter", m, body)) as string,
    );
  }

  test("Share: Page onboarding to a SilverBullet space uploads the page", async () => {
    w.cfg["share.silverbullet.spaces"] = [SPACE];
    w.editorText = "Hello\n";
    await w.h.commands.get("Share: Page")!();
    expect(w.remote.get("Page")!.text).toBe("Hello\n");
    expect(extractFrontMatter(parseMarkdown(w.editorText)).share).toEqual({
      uri: URI,
      mode: "push",
    });
    expect(w.notifications).toEqual([["Share complete!", undefined]]);
    expect(w.store.get(`share.base:${URI}`)).toBe("Hello\n");
    // Already in sync: a later share has nothing to push
    const before = w.fetches.length;
    w.pages.set("Page", w.editorText);
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.fetches.length).toBe(before);
  });

  test("onboarding passes transformed content and ignores a returned hash", async () => {
    let received: any;
    w.h.services.push({
      selector: "share:onboard",
      match: { name: "Uploads itself" },
      run: async (data: any) => {
        received = data;
        w.other.set(OTHER, data.content);
        return { uri: OTHER, mode: "push", hash: "zzzzzzzz" };
      },
      id: "uploads-itself",
    });
    w.editorText = "Hello<!-- x -->\n";
    w.shareProvider = "Uploads itself";
    await w.h.commands.get("Share: Page")!();
    expect(received.text).toBe("Hello<!-- x -->\n");
    expect(received.content).toBe("Hello\n");
    expect(w.notifications).toEqual([["Share complete!", undefined]]);
    expect(extractFrontMatter(parseMarkdown(w.editorText)).share).toEqual({
      uri: OTHER,
      mode: "push",
    });
    expect(w.other.get(OTHER)).toBe("Hello\n");
    expect(w.store.get(`share.base:${OTHER}`)).toBe("Hello\n");
    expect(w.fetches).toEqual([]);
  });

  test("push transforms and records the base, without touching the page", async () => {
    await setPage({ uri: OTHER, mode: "push" }, "B<!-- x -->\n");
    const before = w.pages.get("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.other.get(OTHER)).toBe("B\n");
    expect(w.store.get(`share.base:${OTHER}`)).toBe("B\n");
    expect(w.pages.get("Page")).toBe(before);
  });

  test("push with nothing new since this device pushed makes no request", async () => {
    await setPage({ uri: OTHER, mode: "push" }, "B<!-- x -->\n");
    w.store.set(`share.base:${OTHER}`, "B\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.fetches).toEqual([]);
    expect(w.other.size).toBe(0);
  });

  test("push compares with the remote when there is no base", async () => {
    await w.setup("A\n", "B\n", "B\n", { mode: "push", storeBase: false });
    const before = w.pages.get("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.methods()).toEqual(["GET"]);
    expect(w.store.get(`share.base:${URI}`)).toBe("B\n");
    expect(w.pages.get("Page")).toBe(before);
  });

  test("push overwrites a remote edited since the last push", async () => {
    await w.setup("A\n", "B\n", "R\n", { mode: "push" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.remote.get("Page")!.text).toBe("B\n");
    for (const put of w.fetches.filter((f) => f.opts?.method === "PUT")) {
      expect(put.opts.headers["If-Match"]).toBeUndefined();
    }
  });

  test("sync pushes when only local changed and records the base text", async () => {
    await w.setup("A\n", "B\n", "A\n");
    const before = w.pages.get("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.methods()).toEqual(["GET", "PUT"]);
    expect(w.fetches[1].opts.headers["If-Match"]).toBe('"e1"');
    expect(w.remote.get("Page")!.text).toBe("B\n");
    expect(w.store.get(`share.base:${URI}`)).toBe("B\n");
    expect(w.pages.get("Page")).toBe(before);
  });

  test("sync takes the remote when only it changed", async () => {
    await w.setup("A\n", "A\n", "C\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(await w.localBody()).toBe("C\n");
    expect(w.localShare()).toEqual({ uri: URI, mode: "sync" });
    expect(w.store.get(`share.base:${URI}`)).toBe("C\n");
    expect(w.methods()).toEqual(["GET"]);
  });

  test("sync with equal sides records the base without writing", async () => {
    await w.setup("A\n", "B\n", "B\n", { storeBase: false });
    const before = w.pages.get("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.methods()).toEqual(["GET"]);
    expect(w.store.get(`share.base:${URI}`)).toBe("B\n");
    expect(w.pages.get("Page")).toBe(before);
    expect(w.chooseVersions).toEqual([]);
  });

  describe("sync without base asks which version", () => {
    beforeEach(async () => {
      await w.setup("A\n", "B\n", "C\n", { storeBase: false });
    });

    test("asks with both sides", async () => {
      await w.h.call("share.sharePage", "Page");
      expect(w.chooseVersions).toEqual([
        {
          title: "Which version of Page?",
          message:
            "This device can't tell which side changed since the last share.",
          mine: "B\n",
          theirs: "C\n",
          choices: [
            { id: "theirs", label: "Take theirs" },
            { id: "mine", label: "Keep mine" },
            { id: "copy", label: "Save theirs as a copy" },
          ],
        },
      ]);
    });

    test("theirs", async () => {
      w.chooseAnswer = "theirs";
      expect(await w.h.call("share.sharePage", "Page")).toBe(true);
      expect(await w.localBody()).toBe("C\n");
      expect(w.store.get(`share.base:${URI}`)).toBe("C\n");
      expect(w.methods()).toEqual(["GET"]);
    });

    test("mine", async () => {
      w.chooseAnswer = "mine";
      const before = w.pages.get("Page");
      expect(await w.h.call("share.sharePage", "Page")).toBe(true);
      expect(w.methods()).toEqual(["GET", "PUT"]);
      expect(w.fetches[1].opts.headers["If-Match"]).toBe('"e1"');
      expect(w.remote.get("Page")!.text).toBe("B\n");
      expect(w.store.get(`share.base:${URI}`)).toBe("B\n");
      expect(w.pages.get("Page")).toBe(before);
    });

    test("copy", async () => {
      w.chooseAnswer = "copy";
      const before = w.pages.get("Page");
      expect(await w.h.call("share.sharePage", "Page")).toBeNull();
      const copy = `Page.conflicted-${sha256("C\n").slice(0, 8)}`;
      expect(w.pages.get(copy)).toBe("C\n");
      expect(w.pages.get("Page")).toBe(before);
      expect(w.remote.get("Page")!.text).toBe("C\n");
      expect(w.store.has(`share.base:${URI}`)).toBe(false);
      expect(w.notifications).toEqual([
        [`Saved their version as ${copy}`, undefined],
      ]);
    });

    test("cancel", async () => {
      const before = w.pages.get("Page");
      expect(await w.h.call("share.sharePage", "Page")).toBe(false);
      expect(w.methods()).toEqual(["GET"]);
      expect([...w.pages.keys()]).toEqual(["Page"]);
      expect(w.pages.get("Page")).toBe(before);
      expect(w.remote.get("Page")!.text).toBe("C\n");
      expect(w.store.has(`share.base:${URI}`)).toBe(false);
    });
  });

  test("a legacy hash stands in for a missing base", async () => {
    for (const mode of ["sync", "pull"]) {
      await w.setup("A\n", "A\n", "C\n", {
        mode,
        storeBase: false,
        legacyHash: true,
      });
      expect(await w.h.call("share.sharePage", "Page"), mode).toBe(true);
      expect(await w.localBody(), mode).toBe("C\n");
      expect(w.store.get(`share.base:${URI}`), mode).toBe("C\n");
      w.store.delete(`share.base:${URI}`);
    }
    expect(w.chooseVersions).toEqual([]);
    expect(w.confirms).toEqual([]);
  });

  test("a legacy hash only skips a push when transforms change nothing", async () => {
    for (const body of ["A<!-- note -->\n", "A\n<!--\nnote\n-->\n"]) {
      w.fetches = [];
      w.store.delete(`share.base:${URI}`);
      await w.setup(body, body, body, {
        mode: "push",
        storeBase: false,
        legacyHash: true,
      });
      expect(await w.h.call("share.sharePage", "Page"), body).toBe(true);
      expect(w.methods(), body).toEqual(["GET", "PUT"]);
      expect(w.remote.get("Page")!.text, body).not.toContain("note");
      expect(w.store.get(`share.base:${URI}`), body).toBe(
        w.remote.get("Page")!.text,
      );
    }
  });

  test("a remote's own share keys are ignored", async () => {
    await w.setup("A\n", "A\n", "", { mode: "pull" });
    const shared =
      "---\nshare.uri: x://elsewhere\nshare.hash: abcd1234\n---\nC\n";
    w.setRemote("Page", shared);
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(await w.localBody()).toBe("C\n");
    expect(w.localShare()).toEqual({ uri: URI, mode: "pull" });
    expect(w.store.get(`share.base:${URI}`)).toBe("C\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.confirms).toEqual([]);
    expect(w.localShare()).toEqual({ uri: URI, mode: "pull" });
  });

  test("a merge equal to one side doesn't rewrite that side", async () => {
    await w.setup("A\n", "B\n", "C\n");
    w.mergeText = () => ({ status: "clean", text: "C\n" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.methods()).toEqual(["GET"]);
    expect(await w.localBody()).toBe("C\n");
    expect(w.store.get(`share.base:${URI}`)).toBe("C\n");

    await w.setup("A\n", "B\n", "C\n");
    w.fetches = [];
    const before = w.pages.get("Page");
    w.mergeText = () => ({ status: "clean", text: "B\n" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.methods()).toEqual(["GET", "PUT"]);
    expect(w.remote.get("Page")!.text).toBe("B\n");
    expect(w.pages.get("Page")).toBe(before);
    expect(w.store.get(`share.base:${URI}`)).toBe("B\n");
  });

  test("a legacy hash of an unchanged page means a push has nothing to do", async () => {
    await w.setup("A\n", "A\n", "R\n", {
      mode: "push",
      storeBase: false,
      legacyHash: true,
    });
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.fetches).toEqual([]);
  });

  test("managed pages pull without asking when nothing is known", async () => {
    await w.setup(
      "x\n",
      "---\ntags: meta/repository\n---\nA\n",
      "---\ntags: meta/repository\n---\nC\n",
      { mode: "pull", storeBase: false },
    );
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(await w.localBody()).toBe("---\ntags: meta/repository\n---\nC\n");
    expect(w.localShare()).toEqual({ uri: URI, mode: "pull" });
    expect(w.confirms).toEqual([]);
  });

  test("a managed page edited since its legacy hash asks before a pull", async () => {
    await w.setup(
      "---\ntags: meta/repository\n---\nA\n",
      "---\ntags: meta/repository\n---\nB\n",
      "---\ntags: meta/repository\n---\nC\n",
      { mode: "pull", storeBase: false, legacyHash: true },
    );
    w.confirmAnswer = false;
    const before = w.pages.get("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.confirms).toEqual([
      `Page differs from ${URI}. Overwrite it with the remote version?`,
    ]);
    expect(w.pages.get("Page")).toBe(before);
    expect(w.store.has(`share.base:${URI}`)).toBe(false);
  });

  test("push with a base writes without reading the remote", async () => {
    await w.setup("A\n", "B\n", "A\n", { mode: "push" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.methods()).toEqual(["PUT"]);
    expect(w.remote.get("Page")!.text).toBe("B\n");
    expect(w.store.get(`share.base:${URI}`)).toBe("B\n");
  });

  test("push back to an earlier version writes even if the remote reads stale", async () => {
    const writes: string[] = [];
    const set = w.other.set.bind(w.other);
    w.other.set = (k: string, v: string) => {
      writes.push(v);
      return set(k, v);
    };
    await setPage({ uri: OTHER, mode: "push" }, "A\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    await setPage({ uri: OTHER, mode: "push" }, "B\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    // A stale reader still serves A
    set(OTHER, "A\n");
    await setPage({ uri: OTHER, mode: "push" }, "A\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(writes).toEqual(["A\n", "B\n", "A\n"]);
    expect(w.store.get(`share.base:${OTHER}`)).toBe("A\n");
  });

  test("bases this device records are marked", async () => {
    await w.setup("A\n", "B\n", "A\n");
    await w.h.call("share.sharePage", "Page");
    expect(w.store.get(`share.base:${URI}`)).toBe("B\n");
    expect(w.store.get(`share.baseV2:${URI}`)).toBe(true);
  });

  test("a base from before another device shared the page is not used", async () => {
    // Another device shared B (its legacy hash), this device's old base is A
    await w.setup("B\n", "C\n", "D\n", { legacyHash: true });
    w.store.set(`share.base:${URI}`, "A\n");
    w.mergeText = () => ({ status: "clean", text: "M\n" });
    const before = w.pages.get("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.merges).toEqual([]);
    expect(w.chooseVersions).toHaveLength(1);
    expect(w.pages.get("Page")).toBe(before);
    expect(await w.h.call("share.status", "Page")).toEqual({
      uri: URI,
      mode: "sync",
      state: "unknown",
    });
  });

  test("a marked base is trusted even when the legacy hash differs", async () => {
    await w.setup("B\n", "C\n", "D\n", { legacyHash: true });
    w.store.set(`share.base:${URI}`, "A\n");
    w.store.set(`share.baseV2:${URI}`, true);
    w.mergeText = () => ({ status: "clean", text: "M\n" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.merges).toEqual([["A\n", "C\n", "D\n"]]);
    expect(w.chooseVersions).toEqual([]);
  });

  test("pull asks when local changed since the base", async () => {
    await w.setup("A\n", "B\n", "C\n", { mode: "pull" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.confirms).toEqual([
      `You changed Page locally. Overwrite it with the version from ${URI}?`,
    ]);
    expect(await w.localBody()).toBe("C\n");
    expect(w.store.get(`share.base:${URI}`)).toBe("C\n");
  });

  test("pull asks when there is no base", async () => {
    await w.setup("A\n", "B\n", "C\n", { mode: "pull", storeBase: false });
    w.confirmAnswer = false;
    const before = w.pages.get("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.confirms).toEqual([
      `Page differs from ${URI}. Overwrite it with the remote version?`,
    ]);
    expect(w.pages.get("Page")).toBe(before);
    expect(w.store.has(`share.base:${URI}`)).toBe(false);
  });

  test("pull without changes on either side records the base", async () => {
    await w.setup("A\n", "C\n", "C\n", { mode: "pull" });
    const before = w.pages.get("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.pages.get("Page")).toBe(before);
    expect(w.store.get(`share.base:${URI}`)).toBe("C\n");
  });

  test("sync merges through space.mergeText for any provider", async () => {
    await setPage({ uri: OTHER, mode: "sync" }, "B\n");
    w.other.set(OTHER, "C\n");
    w.store.set(`share.base:${OTHER}`, "A\n");
    w.mergeText = () => ({ status: "clean", text: "M\n" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.merges).toEqual([["A\n", "B\n", "C\n"]]);
    expect(await w.localBody()).toBe("M\n");
    expect(w.localShare()).toEqual({ uri: OTHER, mode: "sync" });
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
    expect(await w.h.call("share.sharePage", "Page")).toBeNull();
    expect(await w.localBody()).toBe(marked);
    expect(w.remote.get("Page")!.text).toBe(marked);
    expect(w.localShare()).toEqual({ uri: URI, mode: "sync" });
    expect(w.store.get(`share.base:${URI}`)).toBe(marked);
    expect(w.notifications).toContainEqual([
      "Merged with conflicts — resolve the markers, then share again",
      "error",
    ]);
  });

  test("unmergeable inputs fall back to a conflict copy", async () => {
    await w.setup("A\n", "B\n", "C\n");
    const before = w.pages.get("Page");
    w.mergeText = () => null;
    expect(await w.h.call("share.sharePage", "Page")).toBeNull();
    expect(w.merges).toHaveLength(1);
    expect(w.methods()).toEqual(["GET"]);
    const copy = `Page.conflicted-${sha256("C\n").slice(0, 8)}`;
    expect(w.pages.get(copy)).toBe("C\n");
    expect(w.pages.get("Page")).toBe(before);
    expect(w.remote.get("Page")!.text).toBe("C\n");
    expect(w.store.get(`share.base:${URI}`)).toBe("A\n");
    expect(w.notifications).toContainEqual([
      `Conflict: remote copy saved as ${copy}`,
      "error",
    ]);
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

  test("library pulls never probe or prompt", async () => {
    const lib = "https://raw.githubusercontent.com/u/r/main/Lib.md";
    const hash = await w.h.call("share.legacyHash", "v1\n");
    w.pages.set(
      "Page",
      `---\nshare.uri: ${lib}\nshare.mode: pull\nshare.hash: ${hash}\n---\nv1\n`,
    );
    expect(w.localShare().hash).toBeDefined();
    w.genericReads.set(lib, "v2\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    // No space probes (or any other request through the proxy)
    expect(w.fetches.map((f) => f.url)).toEqual([]);
    expect(w.confirms).toEqual([]);
    expect(await w.localBody()).toBe("v2\n");
    expect(w.localShare()).toEqual({ uri: lib, mode: "pull" });
  });

  test("a pull from a known space uses its transport", async () => {
    await w.setup("A\n", "A\n", "C\n", {
      mode: "pull",
      storeBase: false,
      legacyHash: true,
    });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.fetches.map((f) => f.url)).toEqual([FS]);
    expect(w.fetches[0].opts.headers.Authorization).toBe("Bearer token");
    expect(await w.localBody()).toBe("C\n");
  });

  test("share.transform settings survive taking the remote", async () => {
    await setPage(
      { uri: URI, mode: "sync", transform: { comments: false } },
      "A\n",
    );
    w.store.set(`share.base:${URI}`, "A\n");
    w.setRemote("Page", "C\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(await w.localBody()).toBe("C\n");
    expect(w.localShare()).toEqual({
      uri: URI,
      mode: "sync",
      transform: { comments: false },
    });
  });
});

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

  const hashOf = (text: string) => w.h.call("share.legacyHash", text);

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
    // Already in sync: a later share reads the remote and has nothing to push
    w.fetches = [];
    w.pages.set("Page", w.editorText);
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.methods()).toEqual(["GET"]);
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
    expect(w.fetches).toEqual([]);
  });

  test("push transforms, without touching the page or the device store", async () => {
    await setPage({ uri: OTHER, mode: "push" }, "B<!-- x -->\n");
    const before = w.pages.get("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.other.get(OTHER)).toBe("B\n");
    expect(w.pages.get("Page")).toBe(before);
    expect(w.store.size).toBe(1); // just the credential
  });

  test("push compares the transformed text with the remote", async () => {
    await setPage({ uri: OTHER, mode: "push" }, "B<!-- x -->\n");
    w.other.set(OTHER, "B\n");
    const writes: string[] = [];
    const set = w.other.set.bind(w.other);
    w.other.set = (k: string, v: string) => {
      writes.push(v);
      return set(k, v);
    };
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(writes).toEqual([]);
  });

  test("push with the remote already at the page reads only", async () => {
    await w.setup("A\n", "B\n", "B\n", { mode: "push", hash: false });
    const before = w.pages.get("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.methods()).toEqual(["GET"]);
    expect(w.pages.get("Page")).toBe(before);
  });

  test("push overwrites a remote edited since the last push", async () => {
    await w.setup("A\n", "B\n", "R\n", { mode: "push" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.remote.get("Page")!.text).toBe("B\n");
    expect(w.methods()).toEqual(["GET", "PUT"]);
    for (const put of w.fetches.filter((f) => f.opts?.method === "PUT")) {
      expect(put.opts.headers["If-Match"]).toBeUndefined();
    }
  });

  test("push creates a missing remote", async () => {
    await w.setup("A\n", "B\n", "x\n", { mode: "push", hash: false });
    w.remote.delete("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.methods()).toEqual(["GET", "PUT"]);
    expect(w.remote.get("Page")!.text).toBe("B\n");
  });

  test("push writes whenever the transformed text differs from the remote, whatever share.hash says", async () => {
    for (const body of ["A<!-- note -->\n", "A\n<!--\nnote\n-->\n"]) {
      w.fetches = [];
      await w.setup(body, body, body, { mode: "push" });
      expect(await w.h.call("share.sharePage", "Page"), body).toBe(true);
      expect(w.methods(), body).toEqual(["GET", "PUT"]);
      expect(w.remote.get("Page")!.text, body).not.toContain("note");
    }
  });

  test("push compares with what the remote reads, stale or not", async () => {
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
    // A reader serving A (stale or not): back at A, there is nothing to send
    set(OTHER, "A\n");
    await setPage({ uri: OTHER, mode: "push" }, "A\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(writes).toEqual(["A\n", "B\n"]);
  });

  test("push never writes share.hash", async () => {
    await w.setup("A\n", "B\n", "A\n", { mode: "push", hash: false });
    expect(await w.sharePage()).toBe(true);
    expect(w.localShare()).toEqual({ uri: URI, mode: "push" });
    await w.setup("A\n", "B\n", "B\n", { mode: "push", hash: false });
    expect(await w.sharePage()).toBe(false);
    expect(w.localShare()).toEqual({ uri: URI, mode: "push" });
  });

  test("sync pushes when only local changed and records its hash", async () => {
    await w.setup("A\n", "B\n", "A\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.methods()).toEqual(["GET", "PUT"]);
    expect(w.fetches[1].opts.headers["If-Match"]).toBe('"e1"');
    expect(w.remote.get("Page")!.text).toBe("B\n");
    expect(await w.localBody()).toBe("B\n");
    expect(w.localShare().hash).toBe(await hashOf("B\n"));
  });

  test("sync takes the remote when only it changed", async () => {
    await w.setup("A\n", "A\n", "C\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(await w.localBody()).toBe("C\n");
    expect(w.localShare()).toEqual({
      uri: URI,
      mode: "sync",
      hash: await hashOf("C\n"),
    });
    expect(w.methods()).toEqual(["GET"]);
  });

  test("sync with equal sides records the hash without writing the remote", async () => {
    await w.setup("A\n", "B\n", "B\n", { hash: false });
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.methods()).toEqual(["GET"]);
    expect(await w.localBody()).toBe("B\n");
    expect(w.localShare().hash).toBe(await hashOf("B\n"));
    expect(w.chooseVersions).toEqual([]);
  });

  describe("sync without a share.hash asks which version", () => {
    beforeEach(async () => {
      await w.setup("A\n", "B\n", "C\n", { hash: false });
    });

    test("asks with both sides", async () => {
      await w.h.call("share.sharePage", "Page");
      expect(w.chooseVersions).toEqual([
        {
          title: "Which version of Page?",
          message:
            "There's no record of the last share to tell which side changed.",
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
      expect(w.localShare().hash).toBe(await hashOf("C\n"));
      expect(w.methods()).toEqual(["GET"]);
    });

    test("mine", async () => {
      w.chooseAnswer = "mine";
      expect(await w.h.call("share.sharePage", "Page")).toBe(true);
      expect(w.methods()).toEqual(["GET", "PUT"]);
      expect(w.fetches[1].opts.headers["If-Match"]).toBe('"e1"');
      expect(w.remote.get("Page")!.text).toBe("B\n");
      expect(await w.localBody()).toBe("B\n");
      expect(w.localShare().hash).toBe(await hashOf("B\n"));
    });

    test("copy", async () => {
      w.chooseAnswer = "copy";
      const before = w.pages.get("Page");
      expect(await w.h.call("share.sharePage", "Page")).toBeNull();
      const copy = `Page.conflicted-${sha256("C\n").slice(0, 8)}`;
      expect(w.pages.get(copy)).toBe("C\n");
      expect(w.pages.get("Page")).toBe(before);
      expect(w.remote.get("Page")!.text).toBe("C\n");
      expect(w.notifications).toEqual([
        [`Saved their version as ${copy}`, undefined],
      ]);
    });

    test("cancel", async () => {
      const before = w.pages.get("Page");
      // nil: the user knows the sides still differ
      expect(await w.h.call("share.sharePage", "Page")).toBeNull();
      expect(w.methods()).toEqual(["GET"]);
      expect([...w.pages.keys()]).toEqual(["Page"]);
      expect(w.pages.get("Page")).toBe(before);
      expect(w.remote.get("Page")!.text).toBe("C\n");
    });
  });

  describe("sync with both sides changed since the share.hash asks which version", () => {
    beforeEach(async () => {
      await w.setup("A\n", "B\n", "C\n");
    });

    test("asks, saying both changed", async () => {
      expect(await w.h.call("share.sharePage", "Page")).toBeNull();
      expect(w.chooseVersions).toHaveLength(1);
      expect(w.chooseVersions[0]).toMatchObject({
        message: "Both sides changed since the last share.",
        mine: "B\n",
        theirs: "C\n",
      });
      expect(w.methods()).toEqual(["GET"]);
    });

    test("theirs", async () => {
      w.chooseAnswer = "theirs";
      expect(await w.h.call("share.sharePage", "Page")).toBe(true);
      expect(await w.localBody()).toBe("C\n");
      expect(w.localShare().hash).toBe(await hashOf("C\n"));
    });

    test("mine", async () => {
      w.chooseAnswer = "mine";
      expect(await w.h.call("share.sharePage", "Page")).toBe(true);
      expect(w.methods()).toEqual(["GET", "PUT"]);
      expect(w.fetches[1].opts.headers["If-Match"]).toBe('"e1"');
      expect(w.remote.get("Page")!.text).toBe("B\n");
      expect(w.localShare().hash).toBe(await hashOf("B\n"));
    });
  });

  test("the hash tells that only the remote changed, for sync and pull", async () => {
    for (const mode of ["sync", "pull"]) {
      await w.setup("A\n", "A\n", "C\n", { mode });
      expect(await w.h.call("share.sharePage", "Page"), mode).toBe(true);
      expect(await w.localBody(), mode).toBe("C\n");
      expect(w.localShare().hash, mode).toBe(await hashOf("C\n"));
    }
    expect(w.chooseVersions).toEqual([]);
    expect(w.confirms).toEqual([]);
  });

  test("a remote's own share keys are ignored", async () => {
    await w.setup("A\n", "A\n", "", { mode: "pull" });
    const shared =
      "---\nshare.uri: x://elsewhere\nshare.hash: abcd1234\n---\nC\n";
    w.setRemote("Page", shared);
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(await w.localBody()).toBe("C\n");
    const pulled = { uri: URI, mode: "pull", hash: await hashOf("C\n") };
    expect(w.localShare()).toEqual(pulled);
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.confirms).toEqual([]);
    expect(w.localShare()).toEqual(pulled);
  });

  test("managed pages pull without asking when there is no share.hash", async () => {
    await w.setup(
      "x\n",
      "---\ntags: meta/repository\n---\nA\n",
      "---\ntags: meta/repository\n---\nC\n",
      { mode: "pull", hash: false },
    );
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    const body = "---\ntags: meta/repository\n---\nC\n";
    expect(await w.localBody()).toBe(body);
    expect(w.localShare()).toEqual({
      uri: URI,
      mode: "pull",
      hash: await hashOf(body),
    });
    expect(w.confirms).toEqual([]);
  });

  test("a managed page edited since its share.hash asks before a pull", async () => {
    await w.setup(
      "---\ntags: meta/repository\n---\nA\n",
      "---\ntags: meta/repository\n---\nB\n",
      "---\ntags: meta/repository\n---\nC\n",
      { mode: "pull" },
    );
    w.confirmAnswer = false;
    const before = w.pages.get("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.confirms).toEqual([
      `You changed Page locally. Overwrite it with the version from ${URI}?`,
    ]);
    expect(w.pages.get("Page")).toBe(before);
  });

  test("sync records the agreed text's hash in the page", async () => {
    // Push
    await w.setup("A\n", "B\n", "A\n");
    expect(await w.sharePage()).toBe(true);
    expect(w.localShare().hash).toBe(await hashOf("B\n"));
    // Take the remote
    await w.setup("A\n", "A\n", "C\n");
    expect(await w.sharePage()).toBe(true);
    expect(w.localShare().hash).toBe(await hashOf("C\n"));
    // Recorded once, the hash tells the next share which side changed
    w.setRemote("Page", "N\n");
    expect(await w.sharePage()).toBe(true);
    expect(await w.localBody()).toBe("N\n");
    expect(w.localShare().hash).toBe(await hashOf("N\n"));
    expect(w.chooseVersions).toEqual([]);
  });

  test("recording the hash keeps edits made during the share", async () => {
    await w.setup("A\n", "B\n", "A\n");
    const edited = (await w.h.call(
      "share.setFrontmatter",
      { uri: URI, mode: "sync" },
      "B edited\n",
    )) as string;
    w.beforePut = () => {
      w.pages.set("Page", edited);
    };
    expect(await w.sharePage()).toBe(true);
    expect(w.remote.get("Page")!.text).toBe("B\n");
    expect(await w.localBody()).toBe("B edited\n");
    expect(w.localShare().hash).toBe(await hashOf("B\n"));

    // The same in the editor
    await w.setup("A\n", "C\n", "A\n");
    w.editorText = w.pages.get("Page")!;
    w.beforePut = () => {
      w.editorText = edited;
    };
    expect(
      await w.h.call("share.sharePage").catch((e) => `THREW ${e.message}`),
    ).toBe(true);
    expect(await w.h.call("share.cleanFrontmatter", w.editorText)).toBe(
      "B edited\n",
    );
    expect(extractFrontMatter(parseMarkdown(w.editorText)).share.hash).toBe(
      await hashOf("C\n"),
    );
  });

  test("the hash is written only when it doesn't match the agreed text", async () => {
    // Unchanged, the hash already matching: the page isn't written
    await w.setup("A\n", "A\n", "A\n");
    const writes: string[] = [];
    const set = w.pages.set.bind(w.pages);
    w.pages.set = (name: string, text: string) => {
      writes.push(name);
      return set(name, text);
    };
    expect(await w.sharePage()).toBe(false);
    expect(writes).toEqual([]);
    // Unchanged without a hash: written once
    w.pages.set = set;
    await w.setup("A\n", "A\n", "A\n", { hash: false });
    w.pages.set = (name: string, text: string) => {
      writes.push(name);
      return set(name, text);
    };
    expect(await w.sharePage()).toBe(false);
    expect(writes).toEqual(["Page"]);
    expect(w.localShare().hash).toBe(await hashOf("A\n"));
  });

  test("a cancelled version choice leaves the hash alone", async () => {
    await w.setup("A\n", "B\n", "C\n");
    const before = w.pages.get("Page");
    w.chooseAnswer = undefined;
    expect(await w.sharePage()).toBeNull();
    expect(w.chooseVersions).toHaveLength(1);
    expect(w.pages.get("Page")).toBe(before);
  });

  test("hashes that look like numbers still match", async () => {
    // legacyHash("T46\n") is 83464e55, which YAML would read as a number
    expect(await hashOf("T46\n")).toBe("83464e55");
    await w.setup("A\n", "A\n", "T46\n");
    expect(await w.sharePage()).toBe(true);
    expect(w.localShare().hash).toBe("83464e55");
    // Written unquoted (e.g. by hand), it still stands for the last share
    w.pages.set(
      "Page",
      `---\nshare.uri: ${URI}\nshare.mode: sync\nshare.hash: 83464e55\n---\nT46\n`,
    );
    expect(typeof w.localShare().hash).toBe("number");
    w.setRemote("Page", "C\n");
    expect(await w.sharePage()).toBe(true);
    expect(await w.localBody()).toBe("C\n");
    expect(w.chooseVersions).toEqual([]);
  });

  test("pull writes share.hash when the sides agree or it takes the remote", async () => {
    await w.setup("A\n", "B\n", "B\n", { mode: "pull" });
    expect(await w.sharePage()).toBe(false);
    expect(await w.localBody()).toBe("B\n");
    expect(w.localShare()).toEqual({
      uri: URI,
      mode: "pull",
      hash: await hashOf("B\n"),
    });
    await w.setup("A\n", "A\n", "C\n", { mode: "pull" });
    expect(await w.sharePage()).toBe(true);
    expect(await w.localBody()).toBe("C\n");
    expect(w.localShare()).toEqual({
      uri: URI,
      mode: "pull",
      hash: await hashOf("C\n"),
    });
  });

  test("pull asks when the page changed since its share.hash", async () => {
    await w.setup("A\n", "B\n", "C\n", { mode: "pull" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.confirms).toEqual([
      `You changed Page locally. Overwrite it with the version from ${URI}?`,
    ]);
    expect(await w.localBody()).toBe("C\n");
    expect(w.localShare().hash).toBe(await hashOf("C\n"));
  });

  test("pull asks when there is no share.hash", async () => {
    await w.setup("A\n", "B\n", "C\n", { mode: "pull", hash: false });
    w.confirmAnswer = false;
    const before = w.pages.get("Page");
    expect(await w.h.call("share.sharePage", "Page")).toBe(false);
    expect(w.confirms).toEqual([
      `Page differs from ${URI}. Overwrite it with the remote version?`,
    ]);
    expect(w.pages.get("Page")).toBe(before);
  });

  test("pull keeps the local edits when the remote is still at the share.hash", async () => {
    await w.setup("A\n", "B\n", "A\n", { mode: "pull" });
    const before = w.pages.get("Page");
    expect(await w.sharePage()).toBe(false);
    expect(w.confirms).toEqual([]);
    expect(w.pages.get("Page")).toBe(before);
  });

  test("retries once when the write hits a 412, then asks", async () => {
    await w.setup("A\n", "B\n", "A\n");
    // Someone else writes between our read and our write
    w.beforePut = () => {
      w.beforePut = undefined;
      w.setRemote("Page", "C\n");
    };
    w.chooseAnswer = "mine";
    expect(await w.sharePage()).toBe(true);
    expect(w.methods()).toEqual(["GET", "PUT", "GET", "PUT"]);
    expect(w.fetches[1].opts.headers["If-Match"]).toBe('"e1"');
    // Both sides changed since the share.hash by the second read
    expect(w.chooseVersions).toHaveLength(1);
    expect(w.chooseVersions[0].theirs).toBe("C\n");
    expect(w.remote.get("Page")!.text).toBe("B\n");
    expect(w.localShare().hash).toBe(await hashOf("B\n"));
  });

  test("a Keep mine write that hits a 412 asks again", async () => {
    await w.setup("A\n", "B\n", "C\n");
    w.beforePut = () => {
      w.beforePut = undefined;
      w.setRemote("Page", "D\n");
    };
    w.chooseAnswer = "mine";
    expect(await w.sharePage()).toBe(true);
    expect(w.methods()).toEqual(["GET", "PUT", "GET", "PUT"]);
    expect(w.chooseVersions.map((c) => c.theirs)).toEqual(["C\n", "D\n"]);
    expect(w.remote.get("Page")!.text).toBe("B\n");
  });

  test("gives up when the remote keeps changing", async () => {
    await w.setup("A\n", "B\n", "A\n");
    w.beforePut = () => w.setRemote("Page", `R${w.etagCounter}\n`);
    w.chooseAnswer = "mine";
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
    expect(w.localShare()).toEqual({
      uri: lib,
      mode: "pull",
      hash: await hashOf("v2\n"),
    });
  });

  test("a pull from a known space uses its transport", async () => {
    await w.setup("A\n", "A\n", "C\n", { mode: "pull" });
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(w.fetches.map((f) => f.url)).toEqual([FS]);
    expect(w.fetches[0].opts.headers.Authorization).toBe("Bearer token");
    expect(await w.localBody()).toBe("C\n");
  });

  test("share.transform settings survive taking the remote", async () => {
    await setPage(
      {
        uri: URI,
        mode: "sync",
        transform: { comments: false },
        hash: await hashOf("A\n"),
      },
      "A\n",
    );
    w.setRemote("Page", "C\n");
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    expect(await w.localBody()).toBe("C\n");
    expect(w.localShare()).toEqual({
      uri: URI,
      mode: "sync",
      transform: { comments: false },
      hash: await hashOf("C\n"),
    });
  });

  test("share settings without a uri mean not configured", async () => {
    await setPage({ transform: false }, "A\n");
    expect(await w.sharePage()).toBe("THREW Not configured");
  });

  test("cancelling Which version leaves the outcome to the user", async () => {
    await w.setup("A\n", "B\n", "C\n", { hash: false });
    w.chooseAnswer = undefined;
    expect(await w.sharePage()).toBeNull();
  });

  test("a first push to a write-only transport writes without reading", async () => {
    const written: string[] = [];
    w.h.services.push({
      selector: "net.writeURI:wo:*",
      match: { priority: 10 },
      run: async (data: any) => {
        written.push(data.content);
      },
      id: "write-only",
    });
    await setPage({ uri: "wo:post", mode: "push" }, "A\n");
    expect(await w.sharePage()).toBe(true);
    expect(written).toEqual(["A\n"]);
  });

  test("a first push to a space this device connects to uses that space's target", async () => {
    w.store.clear();
    w.h = await w.load();
    await setPage(
      { uri: URI, mode: "push" },
      "---\nsecret: s\n---\nBody [[#Top]]\n",
    );
    w.setRemote("Page", "Old\n");
    expect(await w.sharePage()).toBe(true);
    // The SilverBullet target keeps frontmatter and links
    expect(w.remote.get("Page")!.text).toBe(
      "---\nsecret: s\n---\nBody [[#Top]]\n",
    );
    expect(await w.sharePage()).toBe(false);
  });

  test("a share: map is never sent", async () => {
    w.pages.set(
      "Page",
      `---\nshare:\n  uri: ${URI}\n  mode: push\n---\nHello\n`,
    );
    expect(await w.sharePage()).toBe(true);
    expect(w.remote.get("Page")!.text).toBe("Hello\n");
  });

  test("onboarding that can't prepare the page says so and offers nothing", async () => {
    w.h.services.push({
      selector: "share:transform",
      match: { name: "Needs a uri" },
      run: async (data: any) => data.ctx.uri.toUpperCase(),
      id: "needs-uri",
    });
    w.editorText = "Hello\n";
    await w.h.commands.get("Share: Page")!();
    expect(w.notifications).toHaveLength(1);
    expect(w.notifications[0][1]).toBe("error");
    expect(w.editorText).toBe("Hello\n");
  });

  test("a first share that fails leaves the page unshared", async () => {
    w.cfg["share.silverbullet.spaces"] = [SPACE];
    w.editorText = "Hello\n";
    w.beforePut = () => {
      throw new Error("offline");
    };
    await w.h.commands.get("Share: Page")!();
    expect(w.editorText).toBe("Hello\n");
    expect(w.notifications.at(-1)![1]).toBe("error");
  });
});

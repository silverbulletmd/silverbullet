import { beforeEach, describe, expect, test } from "vitest";
import { extractFrontMatter } from "../../plugs/index/frontmatter.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import { OTHER, ShareWorld, SPACE, URI } from "./share_world_test_util.ts";

describe("Share.md commands", () => {
  let w: ShareWorld;

  beforeEach(async () => {
    w = await ShareWorld.create();
  });

  const run = (name: string) =>
    (async () => w.h.commands.get(name)!())().catch(
      (e) => `THREW ${e.message}`,
    );

  const editorShare = () =>
    extractFrontMatter(parseMarkdown(w.editorText)).share;

  async function shareInEditor(m: Record<string, unknown>, body: string) {
    w.editorText = (await w.h.call("share.setFrontmatter", m, body)) as string;
  }

  /** Page name shared to SPACE/name in mode, its text `local` with share.hash
   * of `last` (if given), and the remote at `remote` (if given) */
  async function sharedPage(
    name: string,
    mode: string,
    local: string,
    { last, remote }: { last?: string; remote?: string } = {},
  ) {
    const m: Record<string, unknown> = { uri: `${SPACE}/${name}`, mode };
    if (last !== undefined) m.hash = await w.h.call("share.legacyHash", last);
    w.pages.set(
      name,
      (await w.h.call("share.setFrontmatter", m, local)) as string,
    );
    if (remote !== undefined) w.setRemote(name, remote);
  }

  test("unshare removes the share keys, not the remote", async () => {
    await w.setup("A\n", "A\n", "A\n");
    expect(
      await w.h
        .call("share.unshare", "Page")
        .catch((e) => `THREW ${e.message}`),
    ).toBeUndefined();
    expect(w.pages.get("Page")).toBe("A\n");
    expect(w.remote.get("Page")!.text).toBe("A\n");
  });

  test("Share: Unshare asks first, then unshares the current page", async () => {
    await shareInEditor({ uri: URI, mode: "push" }, "A\n");
    w.confirmAnswer = false;
    await run("Share: Unshare");
    expect(w.confirms).toEqual([
      `Stop sharing Page? The copy at ${URI} stays.`,
    ]);
    expect(editorShare()).toEqual({ uri: URI, mode: "push" });
    w.confirmAnswer = true;
    await run("Share: Unshare");
    expect(w.editorText).toBe("A\n");
  });

  test("open remote and copy link use the web URL", async () => {
    await shareInEditor({ uri: URI, mode: "push" }, "A\n");
    await run("Share: Open Remote");
    expect(w.openedUrls).toEqual([URI]);
    await run("Share: Copy Link");
    expect(w.clipboard).toEqual([URI]);
    expect(w.notifications).toEqual([["Copied", undefined]]);
  });

  test("open remote and copy link say so without one", async () => {
    await shareInEditor({ uri: OTHER, mode: "push" }, "A\n");
    await run("Share: Open Remote");
    await run("Share: Copy Link");
    expect(w.openedUrls).toEqual([]);
    expect(w.clipboard).toEqual([]);
    expect(w.notifications).toEqual([
      [`No web page for ${OTHER}`, undefined],
      [`No web page for ${OTHER}`, undefined],
    ]);
  });

  test("all changed shares changed sync pages and differing push pages, not pull", async () => {
    // Push: the remote differs, is missing, or already has the page
    await sharedPage("A", "push", "new\n", { remote: "old\n" });
    await sharedPage("B", "push", "new\n");
    await sharedPage("C", "push", "new\n", { remote: "new\n" });
    // Sync: changed since its share.hash, or not
    await sharedPage("D", "sync", "new\n", { last: "old\n", remote: "old\n" });
    await sharedPage("E", "sync", "old\n", { last: "old\n", remote: "new\n" });
    // Pull: never, even changed since its share.hash
    await sharedPage("F", "pull", "new\n", { last: "old\n", remote: "old\n" });
    expect(
      await w.h.call("share.changedPages").catch((e) => `THREW ${e.message}`),
    ).toEqual(["A", "B", "D"]);
    await run("Share: All Changed");
    for (const name of ["A", "B", "C", "D"]) {
      expect(w.remote.get(name)!.text, name).toBe("new\n");
    }
    expect(w.remote.get("E")!.text).toBe("new\n");
    expect(w.remote.get("F")!.text).toBe("old\n");
    expect(w.notifications).toEqual([["Shared 3 of 3", undefined]]);
  });

  test("all changed reports the first failure", async () => {
    await sharedPage("A", "sync", "new\n", { last: "old\n" });
    await run("Share: All Changed");
    expect(w.notifications).toEqual([
      ["Shared 0 of 1", undefined],
      [`A: Could not read ${SPACE}/A`, "error"],
    ]);
  });

  test("all changed skips pages whose check fails", async () => {
    w.h.services.push({
      selector: "share:transform",
      match: { name: "Fails on Bad" },
      run: async (data: any) => {
        if (data.ctx.page === "Bad") return 42;
      },
      id: "fails-on-bad",
    });
    await sharedPage("Bad", "push", "new\n");
    await sharedPage("Good", "push", "new\n");
    expect(
      await w.h.call("share.changedPages").catch((e) => `THREW ${e.message}`),
    ).toEqual(["Good"]);
  });

  test("all changed leaves out a push page whose remote needs a sign-in", async () => {
    await sharedPage("A", "push", "new\n", { remote: "old\n" });
    await w.newDevice();
    // An empty Lua table
    expect(
      await w.h.call("share.changedPages").catch((e) => `THREW ${e.message}`),
    ).toEqual({});
    expect(w.deviceFlows).toEqual([]);
  });

  test("all changed with nothing to share says so", async () => {
    await run("Share: All Changed");
    expect(w.notifications).toEqual([["Nothing to share", undefined]]);
  });
});

import { beforeEach, describe, expect, test } from "vitest";
import { extractFrontMatter } from "../../plugs/index/frontmatter.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import { OTHER, ShareWorld, URI } from "./share_world_test_util.ts";

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
});

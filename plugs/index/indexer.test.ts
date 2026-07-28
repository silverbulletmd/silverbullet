import { describe, expect, test } from "vitest";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import { indexMarkdown } from "./indexer.ts";

const defaultPageMeta: PageMeta = {
  ref: "",
  tag: "page",
  name: "TestPage",
  perm: "rw",
  lastModified: "2026-07-01T10:00:00Z",
  created: "",
};

describe("anchor records", () => {
  test("emits one anchor record per anchored host", async () => {
    createMockSystem();
    const objects = await indexMarkdown(
      `A paragraph $pp here.\n\n- Item $ii\n\n- [ ] Task $tt\n\n# Header $hh\n`,
      defaultPageMeta,
    );
    const anchors = objects.filter((o: any) => o.tag === "anchor");
    const refs = anchors.map((a: any) => a.ref).sort();
    expect(refs).toEqual(["hh", "ii", "pp", "tt"]);
    for (const a of anchors) {
      expect(["paragraph", "item", "task", "header"]).toContain(a.hostTag);
      expect(a.page).toBe("TestPage");
    }
  });

  test("emits no anchor records when no anchors present", async () => {
    createMockSystem();
    const objects = await indexMarkdown(`Plain paragraph #tag.\n`, {
      ...defaultPageMeta,
      name: "Plain",
    });
    const anchors = objects.filter((o: any) => o.tag === "anchor");
    expect(anchors).toEqual([]);
  });

  test("non-anchorable objects (page, tag) never emit anchor records", async () => {
    createMockSystem();
    // Page name "MyPage" passes isValidAnchorName; a naive filter would
    // incorrectly emit an anchor record pointing at the page itself.
    const objects = await indexMarkdown(`Paragraph #atag.\n`, {
      ...defaultPageMeta,
      ref: "MyPage",
      name: "MyPage",
    });
    const anchors = objects.filter((o: any) => o.tag === "anchor");
    expect(anchors).toEqual([]);
  });

  test("anchor record for fenced data block with $ref", async () => {
    createMockSystem();
    const md = "\n```#person\nname: Pete\n$ref: pete\n```\n";
    const objects = await indexMarkdown(md, {
      ...defaultPageMeta,
      name: "DataPage",
    });
    const anchors = objects.filter((o: any) => o.tag === "anchor");
    expect(anchors).toHaveLength(1);
    expect(anchors[0]).toMatchObject({
      tag: "anchor",
      ref: "pete",
      page: "DataPage",
      hostTag: "person",
      pageLastModified: "2026-07-01T10:00:00Z",
    });
  });

  test("anchor records carry pageLastModified from the page meta", async () => {
    createMockSystem();
    const objects = await indexMarkdown(`A paragraph $pp here.\n`, {
      ...defaultPageMeta,
      lastModified: "2026-07-02T12:00:00Z",
    });
    const anchors = objects.filter((o: any) => o.tag === "anchor");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].pageLastModified).toBe("2026-07-02T12:00:00Z");
  });

  test("list item anchor snippet includes indented child lines", async () => {
    createMockSystem();
    const objects = await indexMarkdown(
      `- Item $ii\n  - child one\n  - child two\n`,
      defaultPageMeta,
    );
    const anchors = objects.filter((o: any) => o.tag === "anchor");
    expect(anchors).toHaveLength(1);
    // This is the whole point of reusing extractSnippet: a list item's
    // indented children come along, rather than a bare truncated first line.
    expect(anchors[0].snippet).toContain("Item $ii");
    expect(anchors[0].snippet).toContain("child one");
    expect(anchors[0].snippet).toContain("child two");
  });

  test("paragraph anchor snippet stops at the paragraph", async () => {
    createMockSystem();
    const objects = await indexMarkdown(
      `A paragraph $pp here.\n\nA second unrelated paragraph.\n`,
      defaultPageMeta,
    );
    const anchors = objects.filter((o: any) => o.tag === "anchor");
    expect(anchors[0].snippet).toContain("A paragraph $pp here.");
    expect(anchors[0].snippet).not.toContain("second unrelated");
  });
});

import type {
  ObjectValue,
  PageMeta,
} from "@silverbulletmd/silverbullet/type/index";
import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import { indexMarkdown, indexPage } from "./indexer.ts";

const defaultPageMeta: PageMeta = {
  ref: "",
  tag: "page",
  name: "TestPage",
  perm: "rw",
  lastModified: "2026-07-01T10:00:00Z",
  created: "",
};

async function runIndexPageForTest(
  name: string,
  text: string,
): Promise<ObjectValue<any>[]> {
  const meta: PageMeta = { ...defaultPageMeta, ref: name, name };
  const tree = parseMarkdown(text);
  const originalSyscall = (globalThis as any).syscall;
  let captured: ObjectValue<any>[] = [];
  (globalThis as any).syscall = (syscallName: string, ...args: any[]) => {
    if (syscallName === "index.indexObjects") {
      // ObjectIndex.indexObjects drains this array in place (objects.shift()),
      // so snapshot before it gets consumed.
      captured = [...args[1]];
    }
    return originalSyscall(syscallName, ...args);
  };
  try {
    await indexPage({ name, tree, meta, text });
  } finally {
    (globalThis as any).syscall = originalSyscall;
  }
  return captured;
}

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

describe("inComment", () => {
  test("objects inside a comment are marked, others are not", async () => {
    createMockSystem();
    const objects = await indexMarkdown(
      "* [ ] Live task\n\n<!--\n\n* [ ] Commented task\n\n-->\n",
      defaultPageMeta,
    );
    const tasks = objects.filter((o: any) => o.tag === "task");
    const live = tasks.find((t: any) => t.name === "Live task");
    const commented = tasks.find((t: any) => t.name === "Commented task");
    expect(live).toBeDefined();
    expect(live.inComment).toBeUndefined();
    expect(commented).toBeDefined();
    expect(commented.inComment).toBe(true);
  });

  test("space-lua and space-style inside a comment are dropped", async () => {
    createMockSystem();
    const objects = await indexMarkdown(
      "<!--\n\n```space-lua\nx = 1\n```\n\n```space-style\nbody { color: red }\n```\n\n-->\n",
      defaultPageMeta,
    );
    expect(objects.some((o: any) => o.tag === "space-lua")).toBe(false);
    expect(objects.some((o: any) => o.tag === "space-style")).toBe(false);
  });

  test("the same blocks outside a comment are still indexed", async () => {
    createMockSystem();
    const objects = await indexMarkdown(
      "```space-lua\nx = 1\n```\n",
      defaultPageMeta,
    );
    expect(objects.some((o: any) => o.tag === "space-lua")).toBe(true);
  });

  test("anchor records inherit the flag from their host", async () => {
    createMockSystem();
    const objects = await indexMarkdown(
      "<!--\n\n* A commented item $anchorname\n\n-->\n",
      defaultPageMeta,
    );
    const anchor = objects.find((o: any) => o.tag === "anchor");
    expect(anchor).toBeDefined();
    expect(anchor.inComment).toBe(true);
  });

  test("user attributes cannot forge the flag outside a comment", async () => {
    createMockSystem();
    const objects = await indexMarkdown(
      "* An item [inComment: true]\n",
      defaultPageMeta,
    );
    const item = objects.find((o: any) => o.tag === "item");
    expect(item).toBeDefined();
    expect(item.inComment).toBeUndefined();
  });
});

describe("recipients", () => {
  test("recipients stamped on hosts", async () => {
    createMockSystem();
    await (globalThis as any).syscall(
      "index.indexObjects",
      "People/Pete Smith",
      [
        {
          ref: "People/Pete Smith",
          tag: "page",
          name: "People/Pete Smith",
          tags: ["recipient"],
          aliases: ["PeteSmith"],
        },
      ],
    );

    const text = [
      "---",
      'recipients: ["petesmith", "[[People/Alice]]", "Sales"]',
      "---",
      "Hello @PeteSmith in a paragraph.",
      "",
      "* [ ] A task for @PeteSmith",
      "* An item for @PeteSmith",
    ].join("\n");
    const objects = await runIndexPageForTest("TestPage", text);

    const page = objects.find((o: any) => o.tag === "page");
    // A frontmatter nickname stamps its @ identifier, like an
    // inline @mention of it would; a wiki link names its page directly.
    expect(page.recipients).toEqual(["@petesmith", "@sales", "People/Alice"]);
    const task = objects.find((o: any) => o.tag === "task");
    expect(task.recipients).toEqual(["@petesmith"]);
    const item = objects.find((o: any) => o.tag === "item");
    expect(item.recipients).toEqual(["@petesmith"]);
    const rel = objects.find((o: any) => o.tag === "relation");
    expect(rel.recipients).toBeUndefined();
  });
});

describe("conflict documents", () => {
  const conflictText = [
    "---",
    "tags: [secret]",
    "aliases: [SecretPage]",
    "displayName: Secret Page",
    "description: A page about secrets",
    "---",
    "",
    "Some paragraph #inline.",
    "",
    "<<<<<<< SB sha256:aaaa1111",
    "first version line",
    "||||||| SB BASE sha256:base1111",
    "base line",
    "=======",
    "second version line",
    ">>>>>>> SB sha256:bbbb2222",
    "",
  ].join("\n");

  test("skips frontmatter/tag indexing for a conflicted page", async () => {
    createMockSystem();
    const objects = await runIndexPageForTest("TestPage", conflictText);

    // No other indexer ran: no frontmatter-derived "tag" objects.
    expect(objects.some((o: any) => o.tag === "tag")).toBe(false);
  });

  test("still returns from a page query, with its bare file-meta fields", async () => {
    createMockSystem();
    const objects = await runIndexPageForTest("TestPage", conflictText);

    const page = objects.find((o: any) => o.tag === "page");
    expect(page).toMatchObject({
      tag: "page",
      ref: "TestPage",
      name: "TestPage",
      lastModified: defaultPageMeta.lastModified,
      perm: defaultPageMeta.perm,
    });
    expect(page.itags).toContain("page");
  });

  test("the page object carries no frontmatter-derived fields", async () => {
    createMockSystem();
    const objects = await runIndexPageForTest("TestPage", conflictText);

    const page = objects.find((o: any) => o.tag === "page");
    expect(page).toBeDefined();
    expect(page.tags ?? []).not.toContain("secret");
    expect(page.aliases).toBeUndefined();
    expect(page.displayName).toBeUndefined();
    expect(page.description).toBeUndefined();
    expect(page.pageDecoration).toBeUndefined();
  });

  test("indexParagraphs still runs, without frontmatter tags leaking in", async () => {
    createMockSystem();
    const objects = await runIndexPageForTest("TestPage", conflictText);

    const paragraph = objects.find((o: any) => o.tag === "paragraph");
    expect(paragraph).toBeDefined();
    expect(paragraph.tags).toEqual(["inline"]);
    expect(paragraph.itags).toEqual(["paragraph", "inline"]);
  });
});

import { beforeEach, describe, expect, test } from "vitest";
import { extractFrontMatter } from "../../plugs/index/frontmatter.ts";
import { parseMarkdown } from "../markdown_parser/parser.ts";
import { OTHER, ShareWorld } from "./share_world_test_util.ts";

const GENERIC = {
  kind: "other",
  defaults: { links: true, comments: true, frontmatter: true, bake: true },
  link: (l: { text: string }) => l.text,
};
const ALL = { links: true, comments: true, frontmatter: true, bake: false };

describe("Share Transforms.md", () => {
  let w: ShareWorld;

  const transform = (text: string, ctx: Record<string, unknown> = {}) =>
    w.h
      .call("share.transform", text, {
        page: "Here",
        uri: "x://Here",
        members: {},
        target: GENERIC,
        steps: ALL,
        ...ctx,
      })
      // Errors as strings: Lua error objects don't survive vitest's reporting
      .catch((e) => `THREW ${e.message}`) as Promise<string>;

  const frontmatterOf = (text: string) => {
    const { range, ...rest } = extractFrontMatter(parseMarkdown(text));
    return rest;
  };

  beforeEach(async () => {
    w = await ShareWorld.create();
    w.pageMetas.set("Here", { tags: [] });
  });

  test("links to non-members become their display text", async () => {
    expect(
      await transform("See [[Other Page]] and [[Other Page|that one]].\n"),
    ).toBe("See Other Page and that one.\n");
  });

  test("transclusions of non-members and documents are removed", async () => {
    expect(await transform("A\n![[Other Page]]\n![[photo.jpg]]\nB\n")).toBe(
      "A\n\n\nB\n",
    );
  });

  test("links inside code are untouched", async () => {
    const text = "`[[Other]]`\n```\n[[Other]]\n```\n";
    expect(await transform(text)).toBe(text);
  });

  test("member links go to the target's link function", async () => {
    const target = {
      kind: "test",
      defaults: ALL,
      link: (l: { page: string; anchor?: string }) => `<${l.page}|${l.anchor}>`,
    };
    expect(
      await transform("[[Blog/Post#Intro]] [[#Top]]", {
        target,
        members: { "Blog/Post": "x://Blog/Post" },
      }),
    ).toBe("<Blog/Post|Intro> <|Top>");
  });

  test("comments are stripped but baked markers kept", async () => {
    const out = await transform(
      "A\n<!--\nprivate\n-->\nB\n<!--#lua 1+1 -->\n2\n<!--/lua-->\n",
    );
    expect(out).not.toContain("private");
    expect(out).toContain("<!--#lua 1+1 -->");
    expect(out).toContain("<!--/lua-->");
    expect(out.startsWith("A\n")).toBe(true);
  });

  test("frontmatter keeps only title, description, tags and drops share.*", async () => {
    const out = await transform(
      "---\ntitle: T\nsecret: s\nshare.uri: u\n---\nBody\n",
    );
    expect(frontmatterOf(out)).toEqual({ title: "T", tags: [] });
    expect(out.endsWith("Body\n")).toBe(true);
  });

  test("a removed comment block leaves no blank gap", async () => {
    expect(await transform("A\n\n<!--\nprivate\n-->\n\nB\n")).toBe("A\n\nB\n");
  });

  test("inline comments are stripped", async () => {
    expect(await transform("Hello <!-- secret --> world\n")).toBe(
      "Hello  world\n",
    );
  });

  test("dotted and quoted private keys do not survive", async () => {
    const out = await transform(
      '---\ntitle: T\nsecret.note: x\n"my key": y\ntags: [a, b]\n---\nBody\n',
    );
    expect(out).not.toContain("secret");
    expect(out).not.toContain("my key");
    expect(frontmatterOf(out)).toEqual({ title: "T", tags: ["a", "b"] });
    expect(out.endsWith("\nBody\n")).toBe(true);
  });

  test("fully private frontmatter disappears", async () => {
    expect(await transform("---\nsecret: s\n---\nBody\n")).toBe("Body\n");
  });

  test("exempt pages are never transformed", async () => {
    const resolved = async (text: string, page: string) =>
      transform(text, {
        page,
        steps: await w.h.call("share.resolveSteps", page, text, GENERIC, null),
      });
    const text =
      "---\ntags: meta/library\nshare.uri: u\n---\n<!--\nc\n-->\n[[Other]]\n";
    expect(await resolved(text, "Here")).toBe(
      "---\ntags: meta/library\n---\n<!--\nc\n-->\n[[Other]]\n",
    );

    w.pageMetas.set("Lib", { tags: ["meta"] });
    const plain = "[[Other]] <!--c-->\n";
    expect(await resolved(plain, "Lib")).toBe(plain);
  });

  test("opt-out", async () => {
    const target = {
      defaults: { links: true, comments: true, frontmatter: true, bake: true },
    };
    const steps = (override: unknown) =>
      w.h.call("share.resolveSteps", "Here", "Body\n", target, override);
    expect(await steps(false)).toEqual({
      links: false,
      comments: false,
      frontmatter: false,
      bake: false,
    });
    expect(await steps({ bake: false })).toEqual({
      links: true,
      comments: true,
      frontmatter: true,
      bake: false,
    });
  });

  describe("targets", () => {
    const GH = "https://github.com/u/r/blob/main/docs";
    // The link text goes through the descriptor chosen for fromUri
    const link = async (
      fromUri: string,
      toUri: string | undefined,
      ref: string,
    ) =>
      transform(`[[${ref}]]`, {
        uri: fromUri,
        target: await w.h.call("share.target", fromUri),
        members: toUri ? { [ref.split(/[#|]/)[0]]: toUri } : {},
      });

    beforeEach(async () => {
      w = await ShareWorld.create({ github: true });
      w.pageMetas.set("Here", { tags: [] });
    });

    test("unclaimed URIs get the generic descriptor", async () => {
      const t = (await w.h.call("share.target", "test://other/Page.md")) as {
        kind: string;
        defaults: unknown;
      };
      expect(t.kind).toBe("other");
      expect(t.defaults).toEqual(GENERIC.defaults);
    });

    test("SilverBullet spaces keep wiki links and defaults", async () => {
      const t = (await w.h.call("share.target", "https://h/n/Page")) as {
        kind: string;
        defaults: unknown;
      };
      expect(t.kind).toBe("silverbullet");
      expect(t.defaults).toEqual({
        links: true,
        comments: true,
        frontmatter: false,
        bake: false,
      });
      expect(
        await link(
          "https://h/n/Page",
          "https://h/n/Notes/B",
          "Notes/B#Intro|b",
        ),
      ).toBe("[[Notes/B#Intro|b]]");
      expect(await link("https://h/n/Page", "https://h/n/B", "B")).toBe(
        "[[B]]",
      );
      expect(await link("https://h/n/Page", undefined, "#Top")).toBe(
        "[[#Top]]",
      );
    });

    test("a URI on an unknown host is not a SilverBullet space", async () => {
      const t = (await w.h.call("share.target", "https://x.test/p/Page")) as {
        kind: string;
      };
      expect(t.kind).toBe("other");
    });

    test("GitHub files link with relative paths and GitHub slugs", async () => {
      const t = (await w.h.call("share.target", `${GH}/a/A.md`)) as {
        kind: string;
        defaults: unknown;
      };
      expect(t.kind).toBe("github");
      expect(t.defaults).toEqual(GENERIC.defaults);
      expect(
        await link(`${GH}/a/A.md`, `${GH}/b/B.md`, "Other#Getting Started|B"),
      ).toBe("[B](../b/B.md#getting-started)");
      expect(await link(`${GH}/A.md`, `${GH}/sub/dir/B.md`, "Other")).toBe(
        "[Other](sub/dir/B.md)",
      );
      expect(await link(`${GH}/a/A.md`, `${GH}/a/B.md`, "Other")).toBe(
        "[Other](B.md)",
      );
      expect(await link(`${GH}/a/A.md`, undefined, "#What's New?")).toBe(
        "[What's New?](#whats-new)",
      );
    });

    test("GitHub URIs without a file path fall back to the text", async () => {
      expect(
        await link("https://github.com/u/r", `${GH}/B.md`, "Other|that"),
      ).toBe("that");
      expect(
        await link(`${GH}/A.md`, "https://github.com/u/r/tree/main", "Other"),
      ).toBe("Other");
      expect(await link("github:u/r", "github:u/r@dev/B.md", "Other")).toBe(
        "Other",
      );
    });

    test("GitHub link paths are percent-encoded per segment", async () => {
      expect(
        await link(`${GH}/A.md`, `${GH}/My Notes/Plan 1.md`, "Other|Plan"),
      ).toBe("[Plan](My%20Notes/Plan%201.md)");
      // Already-encoded URIs are not encoded twice
      expect(
        await link(`${GH}/A.md`, `${GH}/My%20Notes/Plan.md`, "Other|Plan"),
      ).toBe("[Plan](My%20Notes/Plan.md)");
    });

    test("SilverBullet links without a usable target fall back to the text", async () => {
      expect(await link("https://h/n/Page", undefined, "Page|me")).toBe("me");
      expect(await link("https://h/n/Page", "https://h/n/Page", "Page")).toBe(
        "Page",
      );
      expect(
        await link("https://h/n/Page", "https://nowhere/x/B", "Other|b"),
      ).toBe("b");
    });

    test("github: URIs resolve like GitHub URLs", async () => {
      expect(
        await link(
          "github:u/r@dev/docs/A.md",
          "github:u/r@dev/docs/b/B.md",
          "Other#X",
        ),
      ).toBe("[Other](b/B.md#x)");
    });

    test("gist links are their display text", async () => {
      const t = (await w.h.call(
        "share.target",
        "https://gist.github.com/me/abc123",
      )) as { kind: string };
      expect(t.kind).toBe("gist");
      expect(
        await link(
          "https://gist.github.com/me/abc123",
          "https://gist.github.com/me/def",
          "Other|that",
        ),
      ).toBe("that");
    });
  });

  describe("bake and extensions", () => {
    const BAKED = "<!--#lua 1+1 -->\n2\n<!--/lua-->\n";
    const defineTransform = (
      name: string,
      order: number | undefined,
      suffix: string,
    ) =>
      w.h.services.push({
        id: name,
        selector: "share:transform",
        match: order === undefined ? { name } : { name, order },
        run: async (data: { text: string }) => data.text + suffix,
      } as never);

    test("bake expands directives with the spec's options", async () => {
      w.expandMarkdown = () => "expanded";
      expect(await transform("${1+1}", { steps: { ...ALL, bake: true } })).toBe(
        "expanded",
      );
      expect(w.markdownCalls.map((c) => c.fn)).toEqual([
        "bakeSections",
        "expandMarkdown",
      ]);
      expect(w.markdownCalls[1].options).toEqual({
        expandTransclusions: false,
        rewriteTasks: false,
      });
    });

    test("baked markers are dropped when baking", async () => {
      expect(await transform(BAKED, { steps: { ...ALL, bake: true } })).toBe(
        "2\n",
      );
    });

    test("no bake leaves directives alone", async () => {
      expect(await transform("${1+1}")).toBe("${1+1}");
      expect(w.markdownCalls).toEqual([]);
    });

    test("extension services run in order after built-ins", async () => {
      defineTransform("second", 20, "b");
      defineTransform("first", 10, "a");
      defineTransform("last", undefined, "c");
      expect(await transform("[[Other]]")).toBe("Otherabc");
      const text = "---\ntags: meta\n---\n[[Other]]\n";
      const steps = await w.h.call(
        "share.resolveSteps",
        "Here",
        text,
        GENERIC,
        null,
      );
      expect(await transform(text, { steps })).toBe(text);
    });

    test("share.transform: false skips extensions too", async () => {
      defineTransform("ext", undefined, "EXT");
      const text = (await w.h.call(
        "share.setFrontmatter",
        { uri: OTHER, mode: "push", transform: false },
        "Body <!-- c --> [[Other]]\n",
      )) as string;
      w.pages.set("Page", text);
      expect(await w.h.call("share.sharePage", "Page")).toBe(true);
      expect(w.other.get(OTHER)).toBe(
        await w.h.call("share.cleanFrontmatter", text),
      );
    });
  });

  test("a library page is pushed exactly as it is, minus share keys", async () => {
    w.expandMarkdown = () => "BAKED\n";
    const body =
      "---\ntags: meta/library\nsecret: s\n---\n" +
      "Intro <!-- inline --> [[Other Page]]\n<!--\nblock\n-->\n${1+1}\n";
    const text = (await w.h.call(
      "share.setFrontmatter",
      { uri: OTHER, mode: "push" },
      body,
    )) as string;
    w.pages.set("Page", text);
    expect(await w.h.call("share.sharePage", "Page")).toBe(true);
    const cleaned = await w.h.call("share.cleanFrontmatter", text);
    expect(cleaned).toBe(body);
    expect(w.other.get(OTHER)).toBe(cleaned);
  });
});

import { describe, expect, test } from "vitest";
import { parseMarkdown } from "../../client/markdown_parser/parser.ts";
import { createMockSystem } from "../../plug-api/system_mock.ts";
import type { PageMeta } from "@silverbulletmd/silverbullet/type/index";
import type { LintEvent } from "@silverbulletmd/silverbullet/type/client";
import { lintAnchors } from "./lint.ts";
import { indexMarkdown } from "./indexer.ts";

const defaultPageMeta: PageMeta = {
  ref: "TestPage",
  name: "TestPage",
  tag: "page",
  created: "",
  lastModified: "",
  perm: "rw",
};

/**
 * Creates a LintEvent for the given markdown text and runs lintAnchors.
 * Any pages listed in `otherPages` are indexed into the mock system first.
 */
async function runLintForTest(
  text: string,
  options: {
    pageMeta?: PageMeta;
    otherPages?: Record<string, string>;
  } = {},
): ReturnType<typeof lintAnchors> {
  createMockSystem();
  const meta = options.pageMeta ?? defaultPageMeta;

  // Index other pages so resolveAnchor can see them
  if (options.otherPages) {
    for (const [pageName, pageText] of Object.entries(options.otherPages)) {
      const pm: PageMeta = {
        ref: pageName,
        name: pageName,
        tag: "page",
        created: "",
        lastModified: "",
        perm: "rw",
      };
      const objects = await indexMarkdown(pageText, pm);
      await (globalThis as any).syscall("index.indexObjects", pageName, objects);
    }
  }

  // Index the page under test so resolveAnchor sees its own anchors too
  const currentObjects = await indexMarkdown(text, meta);
  await (globalThis as any).syscall(
    "index.indexObjects",
    meta.name,
    currentObjects,
  );

  const tree = parseMarkdown(text);

  const event: LintEvent = {
    tree,
    name: meta.name,
    pageMeta: meta,
    text,
  };

  return lintAnchors(event);
}

describe("lintAnchors", () => {
  test("lint: no anchors — no diagnostics", async () => {
    const diagnostics = await runLintForTest(`Just a normal paragraph.`);
    expect(diagnostics).toEqual([]);
  });

  test("lint: single valid anchor — no diagnostics", async () => {
    const diagnostics = await runLintForTest(
      `This paragraph has $pete here.`,
    );
    expect(diagnostics).toEqual([]);
  });

  test("lint: invalid anchor name (rule A)", async () => {
    // The parser regex already excludes digit-leading names, so $1bad
    // will not be parsed as NamedAnchor. Rule A is a defense-in-depth guard.
    // With the current parser the input below produces no NamedAnchor nodes,
    // so lint correctly emits zero diagnostics (no false positives).
    const diagnostics = await runLintForTest(`Some $1bad text.`);
    expect(diagnostics).toEqual([]);
  });

  test("lint: multiple anchors in one paragraph (rule B)", async () => {
    const diagnostics = await runLintForTest(
      `Para $first and $second here.`,
    );
    // Exactly one diagnostic, pointing at the second anchor
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/multiple anchors/i);
    expect(diagnostics[0].severity).toBe("error");
  });

  test("lint: multiple anchors — only the first is ok, rest are flagged (rule B)", async () => {
    const diagnostics = await runLintForTest(
      `Para $first and $second and $third here.`,
    );
    // The first anchor is fine; second and third each get a diagnostic
    expect(diagnostics).toHaveLength(2);
    for (const d of diagnostics) {
      expect(d.message).toMatch(/multiple anchors/i);
    }
  });

  test("lint: multiple anchors in a list item (rule B)", async () => {
    const diagnostics = await runLintForTest(
      `- Item $one and $two`,
    );
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/multiple anchors/i);
  });

  test("lint: anchors in sibling list items do not cross-contaminate (rule B)", async () => {
    // Two separate items, each with exactly one anchor — no error
    const diagnostics = await runLintForTest(
      `- Item $one\n- Item $two`,
    );
    expect(diagnostics).toEqual([]);
  });

  test("lint: frontmatter $ref colliding with body anchor (rule C2)", async () => {
    const diagnostics = await runLintForTest(
      `---\n$ref: today\n---\n\nA paragraph $today here.\n`,
    );
    // Both the frontmatter range and the body anchor flagged.
    expect(diagnostics.length).toBeGreaterThanOrEqual(2);
    for (const d of diagnostics) {
      expect(d.message).toMatch(/Duplicate anchor "\$today"/);
      expect(d.severity).toBe("error");
    }
  });

  test("lint: same-page duplicate anchor in different blocks (rule C2)", async () => {
    const diagnostics = await runLintForTest(
      `Hello $sup there and sup there.\n\nThere is $sup more.`,
    );
    // Both occurrences flagged
    expect(diagnostics).toHaveLength(2);
    for (const d of diagnostics) {
      expect(d.message).toMatch(/Duplicate anchor "\$sup"/);
      expect(d.severity).toBe("error");
    }
  });

  test("lint: duplicate anchor across pages (rule C)", async () => {
    const diagnostics = await runLintForTest(
      `Para $pete here.`,
      { otherPages: { Other: `Other para $pete here` } },
    );
    // One NamedAnchor on this page, and it's a duplicate — one diagnostic
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/duplicate/i);
    expect(diagnostics[0].severity).toBe("error");
  });

  test("lint: unique anchor across pages — no duplicate diagnostic (rule C)", async () => {
    const diagnostics = await runLintForTest(
      `Para $unique here.`,
      { otherPages: { Other: `Other para $different.` } },
    );
    // No duplicate, no diagnostics
    expect(diagnostics).toEqual([]);
  });

  test("lint: broken anchor link (rule D)", async () => {
    // [[$missing]] refers to an anchor that doesn't exist anywhere
    const diagnostics = await runLintForTest(`Click [[$missing]] please.`);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].message).toMatch(/anchor not found/i);
    expect(diagnostics[0].severity).toBe("error");
  });

  test("lint: valid anchor link — no diagnostic (rule D)", async () => {
    // $exists is defined on the current page
    const diagnostics = await runLintForTest(
      `Para $exists here.\n\nSee [[$exists]].`,
    );
    // The anchor is defined, no broken-link error
    const brokenLinks = diagnostics.filter((d) =>
      /anchor not found/i.test(d.message)
    );
    expect(brokenLinks).toHaveLength(0);
  });

  test("lint: ambiguous bare anchor link (rule E)", async () => {
    // $shared exists on two different pages; [[$shared]] is ambiguous
    const diagnostics = await runLintForTest(
      `See [[$shared]].`,
      {
        otherPages: {
          Other: `First $shared here`,
          Another: `Second $shared here`,
        },
      },
    );
    // At least one diagnostic about ambiguity/duplicate
    const ambiguousDiags = diagnostics.filter((d) =>
      /ambiguous|duplicate/i.test(d.message)
    );
    expect(ambiguousDiags.length).toBeGreaterThanOrEqual(1);
  });

  test("lint: page-qualified link to existing anchor — no diagnostic (rule D/E)", async () => {
    const diagnostics = await runLintForTest(
      `See [[Other$pete]].`,
      { otherPages: { Other: `Anchor $pete here` } },
    );
    const anchorDiags = diagnostics.filter((d) =>
      /anchor not found|ambiguous|duplicate/i.test(d.message)
    );
    expect(anchorDiags).toHaveLength(0);
  });
});

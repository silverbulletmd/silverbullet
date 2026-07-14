import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

const SPACE_FILES = {
  "Outline.md": `# Outline
* plain
- hyphen
* [ ] task
10. ten
100. hundred
* outer
  * inner
    * deeper
`,
};

const PROBES = [
  { text: "plain", label: "plain-asterisk" },
  { text: "hyphen", label: "plain-hyphen" },
  { text: "task", label: "task" },
  { text: "ten", label: "ordered-2-digit" },
  { text: "hundred", label: "ordered-3-digit" },
  { text: "deeper", label: "deep-nesting" },
];

test.use({ spaceFiles: SPACE_FILES });

function measureFirstGlyphX(text: string) {
  const line = Array.from(document.querySelectorAll(".cm-line")).find((l) =>
    l.textContent?.includes(text),
  );
  if (!line) return null;
  const lineRect = line.getBoundingClientRect();
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const t = node.textContent ?? "";
    if (!t.length) continue;
    const r = document.createRange();
    r.selectNodeContents(node);
    const rect = r.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    return rect.left - lineRect.left;
  }
  return null;
}

test("list lines: zero horizontal shift on cursor in/out", async ({
  sbPage,
  sbServer,
}) => {
  await gotoSilverBulletPage(sbPage, sbServer, "Outline");
  await sbPage.locator(".cm-line.sb-line-li").first().waitFor({
    state: "visible",
    timeout: 10_000,
  });

  const h1 = sbPage.locator(".cm-line.sb-line-h1").first();

  for (const probe of PROBES) {
    const lineLocator = sbPage
      .locator(".cm-line", { hasText: probe.text })
      .first();
    await lineLocator.scrollIntoViewIfNeeded();

    // Cursor OUT: park on H1 (live-preview rendering for our line)
    await h1.click();
    await sbPage.waitForTimeout(75);

    const xOut = await sbPage.evaluate(measureFirstGlyphX, probe.text);
    expect(
      xOut,
      `${probe.label}: should have a measurable first glyph (out)`,
    ).not.toBeNull();

    // Cursor IN: click into this list line (raw-source rendering)
    await lineLocator.click();
    await sbPage.waitForTimeout(75);

    const xIn = await sbPage.evaluate(measureFirstGlyphX, probe.text);
    expect(
      xIn,
      `${probe.label}: should have a measurable first glyph (in)`,
    ).not.toBeNull();

    expect(
      Math.abs((xOut as number) - (xIn as number)),
      `${probe.label}: |xOut - xIn| ≤ 1px`,
    ).toBeLessThanOrEqual(1);
  }
});

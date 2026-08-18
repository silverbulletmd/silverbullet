import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";
import { lineProbe, wordX } from "./blockquote_probe.ts";

test.use({
  spaceFiles: {
    "Quotes.md": [
      "> outer",
      ">",
      "> > inner",
      "",
      "> * quoted item",
      "",
      "> Quoted line one",
      "continued without a marker",
      "",
      "> **note** Note title.",
      "> Second line of the note.",
      "",
      "<!--",
      "> commented",
      "> > deeper",
      "-->",
      "",
      "> # Quoted heading",
      "> Body under the heading.",
      "",
      "> > # Deep heading",
      "> > Body under the deep heading.",
      "",
      "> Setext title",
      "> ============",
      "> Body after the setext.",
      "",
      "> > tight markers",
      ">  > spaced markers",
      "",
    ].join("\n"),
  },
});

/** Width of the bar band a line paints — one step per nesting level. */
const band = (line: any) => Number.parseFloat(line.backgroundSize);

/** Width of the *last* band, for a line painting a comment's and a quote's. */
const quoteBand = (line: any) =>
  Number.parseFloat(line.backgroundSize.split(",").pop()!);

/** How many nesting levels wide a line's painted band is. */
const gutterSteps = (line: any, step: number) =>
  Math.round(quoteBand(line) / step);

/**
 * Puts the caret at a column of the line holding `needle`, by document offset.
 * Deliberately not by clicking: a quote's indent is a marker spacer widget, so
 * a click a couple of pixels into the line lands on the widget rather than in
 * the text and places the caret somewhere else — which made every measurement
 * taken afterwards silently wrong rather than failing.
 */
async function caretOnLineOf(page: any, needle: string, column: number) {
  await page.evaluate(
    ({ needle, column }: { needle: string; column: number }) => {
      const view = (globalThis as any).client.editorView;
      const line = view.state.doc.lineAt(
        view.state.doc.toString().indexOf(needle),
      );
      view.dispatch({
        selection: { anchor: Math.min(line.from + column, line.to) },
      });
    },
    { needle, column },
  );
}

/**
 * Puts the caret in the quote marker of the line holding `needle`, and confirms
 * it really did reveal it — otherwise every measurement taken afterwards would
 * be unchanged, and so vacuously equal.
 */
async function revealMarkerOf(page: any, needle: string) {
  await caretOnLineOf(page, needle, 0);
  await expect(
    page.locator(".cm-line", { hasText: needle }).first(),
  ).toHaveText(/^>/);
}

/**
 * Puts the caret on a line that owns no quote marker at all, and confirms it
 * landed there — the caret starts at offset 0, inside the first line's quote
 * marker, so leaving it there would keep that marker revealed and every
 * "hidden" baseline measured afterwards would be a revealed one.
 */
async function caretOnPlainLine(page: any, needle: string) {
  await caretOnLineOf(page, needle, 1);
  await expect
    .poll(() =>
      page.evaluate((needle: string) => {
        const view = (globalThis as any).client.editorView;
        return view.state.doc
          .lineAt(view.state.selection.main.head)
          .text.includes(needle);
      }, needle),
    )
    .toBe(true);
}

test("nested quotes carry distinct depth classes", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-line-blockquote");
  const lines = await lineProbe(page);
  const outer = lines.find((l: any) => l.text.includes("outer"))!;
  const inner = lines.find((l: any) => l.text.includes("inner"))!;
  expect(outer.classes).toContain("sb-line-blockquote-1");
  expect(inner.classes).toContain("sb-line-blockquote-2");
});

test("list depth is counted independently of blockquote depth", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-line-blockquote");
  const lines = await lineProbe(page);
  const item = lines.find((l: any) => l.text.includes("quoted item"))!;
  expect(item.classes).toContain("sb-line-blockquote-1");
  expect(item.classes).toContain("sb-line-li-1");
  expect(item.classes).not.toContain("sb-line-li-2");
});

test("quoted text never renders left of the quote's own edge", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-line-blockquote");
  const lines = await lineProbe(page);
  for (const line of lines) {
    if (line.classes.includes("sb-line-blockquote") && line.x !== null) {
      expect(line.x, line.text).toBeGreaterThanOrEqual(line.gutterEnd);
    }
  }
});

test("each nesting level adds one gutter step and one bar", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-line-blockquote-2");
  // The caret starts at offset 0, inside the first line's own marker, which
  // would render that line revealed and measure its literal `>` instead.
  await caretOnPlainLine(page, "continued without a marker");
  const lines = await lineProbe(page);
  const outer = lines.find((l: any) => l.text.includes("outer"))!;
  const inner = lines.find((l: any) => l.text.includes("inner"))!;
  const step = band(outer);
  // A quote has no gutter of its own: the indent is the marker spacer in the
  // text flow, and the bar paints over it in the `>`'s place. A border here
  // would double every level's indent.
  expect(outer.borderLeft).toBe(0);
  expect(inner.borderLeft).toBe(0);
  // One bar and exactly one step of text indent per level.
  expect(band(inner)).toBeCloseTo(step * 2, 1);
  expect(Math.abs(inner.x! - outer.x! - step)).toBeLessThanOrEqual(1);
});

test("revealing a quote marker does not move the line's text", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-line-blockquote-2");
  await caretOnPlainLine(page, "continued without a marker");
  const hidden = {
    outer: await wordX(page, "outer"),
    inner: await wordX(page, "inner"),
  };
  await revealMarkerOf(page, "outer");
  expect(await wordX(page, "outer")).toBe(hidden.outer);
  await revealMarkerOf(page, "inner");
  expect(await wordX(page, "inner")).toBe(hidden.inner);
});

test("a quoted heading keeps its quote's own indent", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-line-blockquote-2");
  const lines = await lineProbe(page);
  const at = (needle: string) =>
    lines.find((l: any) => l.text.includes(needle))!;
  // A heading line's font is 1.5x the body's, so a gutter measured in `ch`
  // grows with it unless the step is resolved once, above the line.
  expect(at("Quoted heading").borderLeft).toBe(at("Body under the").borderLeft);
  expect(at("Deep heading").borderLeft).toBe(
    at("Body under the deep").borderLeft,
  );
  expect(await wordX(page, "Quoted heading")).toBe(
    await wordX(page, "Body under the heading"),
  );
  expect(await wordX(page, "Deep heading")).toBe(
    await wordX(page, "Body under the deep heading"),
  );
});

test("revealing a quoted heading's marker does not move it either", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-line-blockquote-2");
  await caretOnPlainLine(page, "continued without a marker");
  const hidden = {
    one: await wordX(page, "Quoted heading"),
    two: await wordX(page, "Deep heading"),
  };
  await revealMarkerOf(page, "Quoted heading");
  expect(await wordX(page, "Quoted heading")).toBe(hidden.one);
  await revealMarkerOf(page, "Deep heading");
  expect(await wordX(page, "Deep heading")).toBe(hidden.two);
});

test("extra space between markers does not add an indent", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-line-blockquote-2");
  const lines = await lineProbe(page);
  const step = band(lines.find((l: any) => l.text.includes("outer"))!);
  const extra =
    (await wordX(page, "spaced markers"))! -
    (await wordX(page, "tight markers"))!;
  // Lezer takes one space as the marker's own padding and up to three more as
  // indent, so both lines are depth 2 with two real markers. All that may
  // separate them is the second line's own literal extra space; a stand-in for
  // a marker miscounted as missing would cost a whole marker more.
  expect(extra).toBeGreaterThan(0);
  expect(extra).toBeLessThan(step);
});

test("a setext underline aligns with the title it underlines", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-line-blockquote");
  // Lezer emits no QuoteMark for a setext continuation line, so a stand-in
  // counted from the tree rather than from the text would double its indent.
  expect(await wordX(page, "====")).toBe(await wordX(page, "Setext title"));
  expect(await wordX(page, "Body after the setext")).toBe(
    await wordX(page, "Setext title"),
  );
});

test("a quote inside a comment keeps both gutters", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-comment-block");
  await caretOnPlainLine(page, "continued without a marker");
  const lines = await lineProbe(page);
  const outer = lines.find((l: any) => l.text.includes("outer"))!;
  const step = band(outer);
  const commented = lines.find((l: any) => l.text.includes("commented"))!;
  const deeper = lines.find((l: any) => l.text.includes("deeper"))!;
  expect(commented.classes).toContain("sb-comment-block");
  // The comment keeps a real border gutter; the quote inside it adds its own
  // bars and one step of text indent per level on top.
  expect(Math.round(commented.borderLeft / step)).toBe(1);
  expect(gutterSteps(commented, step)).toBe(1);
  expect(gutterSteps(deeper, step)).toBe(2);
  expect(
    Math.abs(commented.x! - outer.x! - commented.borderLeft),
  ).toBeLessThanOrEqual(1);
  expect(Math.abs(deeper.x! - commented.x! - step)).toBeLessThanOrEqual(1);
});

test("a lazy continuation line aligns with its marker line", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-line-blockquote");
  const lines = await lineProbe(page);
  const marked = lines.find((l: any) => l.text.includes("Quoted line one"))!;
  const lazy = lines.find((l: any) => l.text.includes("continued without"))!;
  expect(lazy.x).toBe(marked.x);
});

test("a nested quote is indented past its parent", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-line-blockquote");
  const lines = await lineProbe(page);
  const outer = lines.find((l: any) => l.text.includes("outer"))!;
  const inner = lines.find((l: any) => l.text.includes("inner"))!;
  expect(inner.x).toBeGreaterThan(outer.x!);
});

test("an admonition's continuation line shares the title's tint", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-admonition");
  const lines = await lineProbe(page);
  const title = lines.find((l: any) => l.text.includes("Note title"))!;
  const body = lines.find((l: any) =>
    l.text.includes("Second line of the note"),
  )!;
  expect(body.background).toBe(title.background);
});

test("a marker spacer has a client rect with real height", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Quotes");
  await page.waitForSelector(".sb-quote-spacer");
  // posAtCoords scans a line's client rects for one overlapping the queried y,
  // and skips only zero-*width* rects. A zero-height spacer rect is therefore
  // never "overlapping": the scan's two y adjustments recurse against each
  // other until the stack overflows. An empty inline-block has exactly that
  // rect, so the spacer takes its width from padding on an inline box instead.
  const heights = await page.evaluate(() =>
    [...document.querySelectorAll(".sb-quote-spacer")].map(
      (s) => s.getBoundingClientRect().height,
    )
  );
  expect(heights.length).toBeGreaterThan(0);
  for (const h of heights) expect(h).toBeGreaterThan(0);
});

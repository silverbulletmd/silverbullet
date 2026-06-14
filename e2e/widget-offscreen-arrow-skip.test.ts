// Regression guard for #1985: arrow keys / clicks below a tall block
// widget (e.g. a `${query[[…]]}` rendering as a table) used to drift by
// a line or two when content was scrolled past the widget.

import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

function manyPageSeed(n: number): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 1; i <= n; i++) {
    out[`Page${i}.md`] = `#page\n\nThis is page ${i}\n`;
  }
  return out;
}

test.use({
  spaceFiles: {
    ...manyPageSeed(20),
    "CursorBug.md": `Hello there [[aspiring page]]

* Hello
* There
* This
* is a list

\${query[[from o = index.tag "page" limit 20]]}
Sup yo

* Another list
* This is it
* Sup
`,
  },
  viewport: { width: 900, height: 500 },
});

test("arrow keys advance one line at a time below a tall widget", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "CursorBug");

  // Wait until the query widget has rendered tall (height map > 100px
  // means it picked up the widget's actual size, not the one-line
  // fallback).
  await page.waitForFunction(
    () => {
      const v = (globalThis as any).client?.editorView;
      return v && v.lineBlockAt(v.state.doc.line(8).from).height > 100;
    },
    undefined,
    { timeout: 10_000 },
  );

  const result = await page.evaluate(() => {
    const v = (globalThis as any).client.editorView;
    v.scrollDOM.scrollTop = v.scrollDOM.scrollHeight;
    const line13 = v.state.doc.line(13);
    v.dispatch({ selection: { anchor: line13.from + line13.text.length } });

    // Sweep up from the bottom list through the widget.
    const visited = [v.state.doc.lineAt(v.state.selection.main.head).number];
    let range = v.state.selection.main;
    for (let i = 0; i < 5; i++) {
      range = v.moveVertically(range, false);
      visited.push(v.state.doc.lineAt(range.head).number);
    }

    // Click resolution: posAtCoords at each rendered line's vertical
    // center must resolve to that same line.
    const clicks: Array<{ line: number; resolvedLine: number | null }> = [];
    for (let i = 9; i <= 13; i++) {
      const ln = v.state.doc.line(i);
      const c = v.coordsAtPos(ln.from);
      const p = v.posAtCoords({ x: c.left + 20, y: (c.top + c.bottom) / 2 });
      clicks.push({
        line: i,
        resolvedLine: p != null ? v.state.doc.lineAt(p).number : null,
      });
    }
    return { visited, clicks };
  });

  expect(result.visited).toEqual([13, 12, 11, 10, 9, 8]);
  for (const { line, resolvedLine } of result.clicks) {
    expect(resolvedLine).toBe(line);
  }
});

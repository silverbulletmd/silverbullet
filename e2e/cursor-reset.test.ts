// Regression guard: the loading→ready widget transition fires
// `rebuildEditorState` *after* the editor is interactive, and used to
// reset the selection to position 0.

import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

test.use({
  spaceFiles: {
    "CursorTest.md": `# Title

Line 2
Line 3
Line 4
Line 5
Line 6
Line 7
Line 8
Line 9
Line 10

\${"a lua directive"}

Line 13
Line 14
`,
  },
});

test("cursor placed mid-document stays put across widget rebuild", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "CursorTest");

  await page.evaluate(() => {
    const view = (globalThis as any).client.editorView;
    view.dispatch({ selection: { anchor: view.state.doc.line(8).from } });
    view.focus();
  });

  // Sample a few times across the window where the rebuild could fire.
  for (let i = 0; i < 10; i++) {
    await page.waitForTimeout(150);
    const line = await page.evaluate(() => {
      const v = (globalThis as any).client.editorView;
      return v.state.doc.lineAt(v.state.selection.main.head).number;
    });
    expect(line).toBe(8);
  }
});

import { expect, gotoSilverBulletPage, test } from "../fixtures/core.ts";

test.use({
  spaceFiles: {
    "index.md": "Welcome",
    "Dashboard.md": [
      'Open: ${#query[[from index.tag "task" where not _.done]]}',
      "",
      '${widget.new { content = function() return "Total: " .. #query[[from index.tag "task"]] end }}',
      "",
    ].join("\n"),
    "Work.md": "- [ ] one\n",
  },
});

test("a plain query and a content view update when a task is added elsewhere", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Dashboard");
  // Out of the directives, so they render
  await page.evaluate(() => {
    const view = (window as any).client.editorView;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  const editor = page.locator("#sb-editor");
  await expect(editor).toContainText("Open: 1");
  await expect(editor).toContainText("Total: 1");
  await page.evaluate(() =>
    (window as any).client.space.writePage("Work", "- [ ] one\n- [ ] two\n"),
  );
  await expect(editor).toContainText("Open: 2", { timeout: 10000 });
  await expect(editor).toContainText("Total: 2", { timeout: 10000 });
});

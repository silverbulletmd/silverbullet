import {
  expect,
  gotoSilverBulletPage,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

const budget = [
  "${salary = 500}",
  "",
  "Raise of ${increase = 5}% gives ${salary * (1 + increase / 100)}",
  "",
].join("\n");

test.use({
  spaceFiles: {
    "Budget.md": budget,
    "Report.md": '![[Budget]]\n\nRead: ${pageVars.get("increase", "Budget")}\n',
    "Totals.md":
      '${open = #query[[from index.tag "task" where not _.done]]}\n\nOpen tasks: ${open}\n',
    "Work.md": "- [ ] one\n",
    "Sheet.md":
      '${rate = 2}\n\nDouble: ${rate * 2}\n\n${widgets.button("Raise", function() pageVars.set("rate", 5) end)}\n',
    "Reader.md": 'Read: ${pageVars.get("rate", "Sheet")}\n',
    "Host.md": "![[Sheet]]\n",
  },
});

test("page scope values update after editing a definition", async ({
  page,
  sbServer,
}) => {
  // Move the cursor out of the transclusion so it renders instead of showing source.
  const showReport = async () => {
    await gotoSilverBulletPage(page, sbServer, "Report");
    await page.evaluate(() => {
      const view = (window as any).client.editorView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
    });
  };
  await showReport();
  await expect(page.locator("#sb-editor")).toContainText("525");
  await expect(page.locator("#sb-editor")).toContainText("Read: 5");

  await gotoSilverBulletPage(page, sbServer, "Budget");
  const editor = page.locator("#sb-editor .cm-content");
  // The cursor starts inside the first cell (shown as source), so check the second.
  await expect(
    editor.locator(".sb-page-var-tag", { hasText: "increase" }),
  ).toBeVisible();
  await expect(editor).toContainText("525");

  await page.evaluate(() => {
    const view = (window as any).client.editorView;
    const text: string = view.state.doc.toString();
    const at = text.indexOf("increase = 5") + "increase = ".length;
    view.dispatch({ changes: { from: at, to: at + 1, insert: "7" } });
  });
  await waitForPersistedContent(sbServer, "Budget.md", /increase = 7/);
  await expect(editor).toContainText("535");

  await showReport();
  await expect(page.locator("#sb-editor")).toContainText("535");
  await expect(page.locator("#sb-editor")).toContainText("Read: 7");
});

test("definitions on a brand-new page resolve after the first save", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Fresh Sheet");
  const editor = page.locator("#sb-editor .cm-content");
  await editor.click();
  await page.keyboard.type("${price = 20} total ${price * 3}\n");
  await waitForPersistedContent(sbServer, "Fresh Sheet.md", /price = 20/);
  await expect(
    editor.locator(".sb-page-var-tag", { hasText: "price" }),
  ).toBeVisible();
  await expect(editor).toContainText("60");
  await expect(editor.locator(".sb-lua-error")).toHaveCount(0);
});

test("an assignment that counts tasks recomputes when a task is added", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Totals");
  await page.evaluate(() => {
    const view = (window as any).client.editorView;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  const editor = page.locator("#sb-editor");
  await expect(editor).toContainText("Open tasks: 1");
  await page.evaluate(() =>
    (window as any).client.space.writePage("Work", "- [ ] one\n- [ ] two\n"),
  );
  await expect(editor).toContainText("Open tasks: 2", { timeout: 10000 });
});

test("a button sets a page variable; the page and its readers update", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Sheet");
  await page.evaluate(() => {
    const view = (window as any).client.editorView;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  const editor = page.locator("#sb-editor");
  await expect(editor).toContainText("Double: 4");
  await editor.getByRole("button", { name: "Raise" }).click();
  await expect(editor).toContainText("Double: 10");
  await waitForPersistedContent(sbServer, "Sheet.md", /\$\{rate = 5\}/);
  await gotoSilverBulletPage(page, sbServer, "Reader");
  await expect(page.locator("#sb-editor")).toContainText("Read: 5");
});

test("a button in a transclusion sets the transcluded page's variable", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Host");
  await page.evaluate(() => {
    const view = (window as any).client.editorView;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  });
  const editor = page.locator("#sb-editor");
  await expect(editor).toContainText("Double: 4");
  await editor.getByRole("button", { name: "Raise" }).click();
  await waitForPersistedContent(sbServer, "Sheet.md", /\$\{rate = 5\}/);
  await expect(editor).toContainText("Double: 10", { timeout: 10000 });
});

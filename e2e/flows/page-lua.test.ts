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
    "Sheet.md":
      '${rate = 2}\n\nDouble: ${rate * 2}\n\n${widgets.button("Raise", function() pageVars.set("rate", 5) end)}\n',
    "Reader.md": 'Read: ${pageVars.get("rate", "Sheet")}\n',
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

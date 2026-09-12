import {
  expect,
  gotoSilverBulletPage,
  mod,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

test.describe("page links and lifecycle", () => {
  test.use({
    spaceFiles: {
      "Source.md": "Read [[Reference]] and continue with [[Draft Target]].\n",
      "Reference.md": "# Reference\n\nA useful reference.\n",
    },
  });

  test("following a wiki link opens the referenced page", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Source");
    await page
      .locator(".sb-wiki-link", { hasText: "Reference" })
      .first()
      .click();

    await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Reference",
    );
    await expect(page.locator("#sb-editor .cm-content")).toContainText(
      "A useful reference.",
    );
  });

  test("an aspiring link creates a page that can be saved and renamed", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Source");
    const missing = page.locator(".sb-wiki-link-missing", {
      hasText: "Draft Target",
    });
    await expect(missing).toBeVisible();
    await missing.click();
    await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Draft Target",
    );

    const editor = page.locator("#sb-editor .cm-content");
    await page.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });
    await page.keyboard.insertText("The page now has durable content.");
    await waitForPersistedContent(
      sbServer,
      "Draft Target.md",
      "The page now has durable content.",
    );

    const pageName = page.locator("#sb-current-page input.sb-input");
    await pageName.click();
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.insertText("Published Target");
    await page.keyboard.press("Enter");

    await waitForPersistedContent(
      sbServer,
      "Published Target.md",
      "The page now has durable content.",
    );
    await expect
      .poll(async () =>
        (
          await page.request.get(`${sbServer.url}/.fs/Draft%20Target.md`)
        ).status(),
      )
      .toBe(404);
    await gotoSilverBulletPage(page, sbServer, "Published Target");
    await expect(editor).toContainText("The page now has durable content.");
  });
});

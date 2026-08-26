import {
  expect,
  gotoSilverBulletPage,
  test,
  waitForEditorReady,
  waitForSaveAndReadFromServer,
} from "./fixtures.ts";
import { createPageViaPagePicker } from "./navigator-ui.ts";

test.describe("Wiki links", () => {
  test.describe("cross-page navigation", () => {
    test.use({
      spaceFiles: {
        "PageA.md": "# Page A\nLink to [[PageB]] here",
        "PageB.md": "# Page B\nThis is page B content",
      },
    });

    test("navigate between pages via wiki link click", async ({
      sbServer,
      page,
    }) => {
      await gotoSilverBulletPage(page, sbServer, "PageA");
      const editor = page.locator("#sb-editor .cm-content");

      await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
        "PageA",
      );
      await expect(editor).toContainText("Page A");

      // Click on the "PageB" text inside the wiki link
      const wikiLinkText = editor.locator(".sb-wiki-link", {
        hasText: "PageB",
      });
      await expect(wikiLinkText).toBeVisible({ timeout: 10_000 });
      await wikiLinkText.click();

      // Should navigate to PageB
      await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
        "PageB",
      );
      await expect(editor).toContainText("Page B");
    });

    test("drag-selecting text released over a wiki link does not navigate", async ({
      sbServer,
      page,
    }) => {
      await gotoSilverBulletPage(page, sbServer, "PageA");
      const editor = page.locator("#sb-editor .cm-content");
      await expect(editor).toContainText("Page A");

      const wikiLinkText = editor.locator(".sb-wiki-link", {
        hasText: "PageB",
      });
      await expect(wikiLinkText).toBeVisible({ timeout: 10_000 });
      const box = (await wikiLinkText.boundingBox())!;

      const y = box.y + box.height / 2;

      // First drag: select from the plain text left of the link to past its
      // end. The selection now overlaps the link, so it re-renders as raw
      // [[PageB]] text.
      await page.mouse.move(box.x - 50, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width + 1, y, { steps: 5 });
      await page.mouse.up();

      // Second drag: select again, releasing on top of the raw link text
      await page.mouse.move(box.x - 50, y);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2, y, { steps: 5 });
      await page.mouse.up();

      // Give any (unwanted) navigation time to kick in
      await page.waitForTimeout(500);
      await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
        "PageA",
      );
      await expect(editor).toContainText("Page A");
    });

    test("drag-selecting within a wiki link does not navigate", async ({
      sbServer,
      page,
    }) => {
      await gotoSilverBulletPage(page, sbServer, "PageA");
      const editor = page.locator("#sb-editor .cm-content");
      await expect(editor).toContainText("Page A");

      const wikiLinkText = editor.locator(".sb-wiki-link", {
        hasText: "PageB",
      });
      await expect(wikiLinkText).toBeVisible({ timeout: 10_000 });
      const box = (await wikiLinkText.boundingBox())!;

      // Drag from the start of the link text to its end, staying inside
      // the rendered link the whole time
      await page.mouse.move(box.x + 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, {
        steps: 5,
      });
      await page.mouse.up();

      await page.waitForTimeout(500);
      await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
        "PageA",
      );
    });
  });

  test("wiki link to non-existent page creates it on click and saves", async ({
    sbPage,
    sbServer,
  }) => {
    const editor = sbPage.locator("#sb-editor .cm-content");
    await expect(editor).toContainText("Welcome");

    // Navigate to a fresh page
    await createPageViaPagePicker(sbPage, "Link Source");
    await expect(editor).toHaveText("");

    // Wait for the editor to finish loading and any pageLoaded handlers
    // to settle before typing. Otherwise CodeMirror reconfigures mid-type
    // and the cursor jumps back to position 0, splitting input.
    await waitForEditorReady(sbPage);
    await editor.click();
    await sbPage.keyboard.type("Check out [[Brand New Page]]", { delay: 20 });

    // Verify the source page with the wiki link is saved to server
    const sourceContent = await waitForSaveAndReadFromServer(
      sbPage,
      sbServer,
      "Link Source.md",
    );
    expect(sourceContent).toContain("[[Brand New Page]]");

    // Move cursor away from the link so it renders
    await sbPage.keyboard.press("Home");

    // Click on the wiki link text to navigate/create
    const wikiLinkText = editor.locator(".sb-wiki-link", {
      hasText: "Brand New Page",
    });
    await expect(wikiLinkText).toBeVisible({ timeout: 10_000 });
    await wikiLinkText.click();

    await expect(sbPage.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Brand New Page",
    );
  });
});

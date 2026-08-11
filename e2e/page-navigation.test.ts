import { expect, test, waitForSaveAndReadFromServer } from "./fixtures.ts";
import {
  createPageViaPagePicker,
  navigateViaPagePicker,
} from "./navigator-ui.ts";

test.describe("Page navigation", () => {
  test("create a new page via page picker", async ({ sbPage, sbServer }) => {
    const editor = sbPage.locator("#sb-editor .cm-content");
    await expect(editor).toContainText(
      "Welcome to the wondrous world of SilverBullet",
    );

    // Open the page picker, type a name nothing matches, and take its create
    // row -- which asserts the picker offered one, the page name landed in the
    // top bar, and the picker closed behind it.
    await createPageViaPagePicker(sbPage, "My New Page");

    // Editor should be empty (new page)
    await expect(editor).toHaveText("");

    // Type content and verify it saves to server
    await editor.click();
    await sbPage.keyboard.type("New page content");
    await expect(editor).toContainText("New page content");

    const content = await waitForSaveAndReadFromServer(
      sbPage,
      sbServer,
      "My New Page.md",
    );
    expect(content).toContain("New page content");
  });

  test("navigate back to index via page picker", async ({ sbPage }) => {
    const editor = sbPage.locator("#sb-editor .cm-content");
    await expect(editor).toContainText(
      "Welcome to the wondrous world of SilverBullet",
    );

    // First, create and navigate to a new page
    await createPageViaPagePicker(sbPage, "Temporary Page");

    // Now navigate back to index
    await navigateViaPagePicker(sbPage, "index");
    await expect(editor).toContainText(
      "Welcome to the wondrous world of SilverBullet",
    );
  });

  test("create a page in a subfolder and verify on server", async ({
    sbPage,
    sbServer,
  }) => {
    const editor = sbPage.locator("#sb-editor .cm-content");
    await expect(editor).toContainText(
      "Welcome to the wondrous world of SilverBullet",
    );

    // Page name should show the full path
    await createPageViaPagePicker(sbPage, "Notes/My Subfolder Page");
    await expect(editor).toHaveText("");

    // Type something and verify it saves to server
    await editor.click();
    await sbPage.keyboard.type("Content in a subfolder page");
    await expect(editor).toContainText("Content in a subfolder page");

    const content = await waitForSaveAndReadFromServer(
      sbPage,
      sbServer,
      "Notes/My Subfolder Page.md",
    );
    expect(content).toContain("Content in a subfolder page");
  });
});

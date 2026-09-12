import {
  expect,
  gotoSilverBulletPage,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

test.describe("task workflows", () => {
  test.use({
    spaceFiles: {
      "Tasks.md":
        "# Tasks\n\n* [ ] Order supplies\n* [ ] Draft agenda\n* [x] Archive notes\n",
    },
  });

  test("toggling a task persists across reopening", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Tasks");
    const checkboxes = page.locator(
      "#sb-editor .sb-checkbox input[type='checkbox']",
    );
    await expect(checkboxes).toHaveCount(3);
    await expect(checkboxes.nth(2)).toBeChecked();
    await expect(checkboxes.first()).not.toBeChecked();

    await checkboxes.first().click();
    await waitForPersistedContent(
      sbServer,
      "Tasks.md",
      /\* \[x\] Order supplies/,
    );

    await gotoSilverBulletPage(page, sbServer, "Tasks");
    await expect(checkboxes.first()).toBeChecked();
  });
});

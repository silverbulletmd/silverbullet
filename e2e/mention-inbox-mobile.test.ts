import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

test.use({
  viewport: { width: 390, height: 844 },
  spaceFiles: {
    "Notes.md": ["Talked to @Sales about the launch.", ""].join("\n"),
  },
});

test("tapping a mention on mobile leaves the inbox filtered on that recipient", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Notes");
  await page.locator("a.sb-at-mention", { hasText: "@Sales" }).click();

  const selected = page.locator("select.sb-nav-dropdown option:checked");
  await expect(selected).toHaveText("Sales");
  // The reported symptom is a late reset, so the assertion has to survive
  // whatever second activation lands after the panel first paints.
  await page.waitForTimeout(1500);
  await expect(selected).toHaveText("Sales");
});

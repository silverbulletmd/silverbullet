import { currentPage, navInput, openPicker } from "../fixtures/actions.ts";
import { expect, shiftChord, test } from "../fixtures/core.ts";

test.describe("search", () => {
  test.use({
    spaceFiles: {
      "index.md": "# Welcome\n",
      "Garden.md": "# Garden\nWater the basil every morning.\n",
      "Kitchen.md": "# Kitchen\nPesto needs garlic.\n",
    },
  });

  test("finds a page by its words and opens it at the match", async ({
    sbPage: page,
  }) => {
    const frame = await openPicker(page, shiftChord("f"), "Pages");
    await navInput(page).fill("basil morning");
    const row = frame.locator(".sb-nav-row", { hasText: "Garden" }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.locator(".sb-nav-description mark").first()).toBeVisible();
    await expect(
      frame.locator(".sb-nav-row", { hasText: "Kitchen" }),
    ).toHaveCount(0);
    await row.click();
    await expect(currentPage(page)).toHaveValue("Garden");

    // Reopening brings back the query, selected, and its results.
    const again = await openPicker(page, shiftChord("f"), "Pages");
    const input = navInput(page);
    await expect(input).toHaveValue("basil morning");
    await expect(
      again.locator(".sb-nav-row", { hasText: "Garden" }).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect
      .poll(() =>
        input.evaluate((el: HTMLInputElement) => [
          el.selectionStart,
          el.selectionEnd,
        ]),
      )
      .toEqual([0, "basil morning".length]);
  });

  test("exact phrase mode is available from the dropdown", async ({
    sbPage: page,
  }) => {
    const frame = await openPicker(page, shiftChord("f"), "Pages");
    await frame
      .locator("select.sb-nav-dropdown")
      .selectOption({ label: "Exact phrase" });
    await navInput(page).fill("needs garlic");
    await expect(
      frame.locator(".sb-nav-row", { hasText: "Kitchen" }).first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});

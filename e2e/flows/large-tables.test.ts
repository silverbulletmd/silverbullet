import { expect, gotoSilverBulletPage, test } from "../fixtures/core.ts";

const largeTablePage = Array.from({ length: 5 }, (_, section) => [
  `## ${2026 - section}`,
  "",
  "| Date | Where | km | Time | Pace | Avg HR | Max HR | Weight | Source |",
  "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |",
  ...Array.from(
    { length: 150 },
    (_, row) =>
      `| 2026-09-${String((row % 28) + 1).padStart(2, "0")} | outdoor | 5.12 | 37:53 | 7:23 | 145 | 163 | 98.1 | Watch ${row} |`,
  ),
  "",
])
  .flat()
  .join("\n");

test.use({ spaceFiles: { "Large Tables.md": largeTablePage } });

test("scrolling past large markdown tables keeps a stable position", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Large Tables");
  const scroller = page.locator("#sb-editor .cm-scroller");
  await expect(page.locator(".sb-table-widget table").first()).toBeVisible();
  await scroller.hover();

  let previous = await scroller.evaluate((element) => element.scrollTop);
  let largestStep = 0;
  for (let i = 0; i < 120; i++) {
    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(75);
    const current = await scroller.evaluate((element) => element.scrollTop);
    largestStep = Math.max(largestStep, Math.abs(current - previous));
    previous = current;
  }

  expect(previous).toBeGreaterThan(20_000);
  // Allow modest height corrections, but never a leap across a whole table.
  expect(largestStep).toBeLessThan(2_000);
});

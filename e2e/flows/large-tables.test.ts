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

  const scrollTop = () => scroller.evaluate((element) => element.scrollTop);
  // The widgets above re-measure after each scroll; wait until the position
  // has stopped moving instead of sleeping a guessed time
  const settled = () =>
    expect
      .poll(async () => {
        const before = await scrollTop();
        await page.waitForTimeout(50);
        return before === (await scrollTop());
      })
      .toBe(true);

  const wheel = 1_200;
  let previous = await scrollTop();
  let largestStep = 0;
  for (let i = 0; i < 30; i++) {
    await page.mouse.wheel(0, wheel);
    await settled();
    const current = await scrollTop();
    largestStep = Math.max(largestStep, Math.abs(current - previous));
    previous = current;
  }

  expect(previous).toBeGreaterThan(20_000);
  // Allow modest height corrections on top of the wheel step, but never a leap
  // across a whole table.
  expect(largestStep).toBeLessThan(wheel + 1_700);
});

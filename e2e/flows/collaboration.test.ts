import { waitForPersistedContent } from "../fixtures/core.ts";
import {
  expect,
  localContent,
  openLivePage,
  test,
} from "../fixtures/offline.ts";

test.use({
  spaceFiles: { "Shared.md": "Shared notebook\nOriginal paragraph.\n" },
});
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Live service-worker synchronization is validated in Chromium",
);

test("two independent editors exchange changes and persist the same document", async ({
  browser,
  page,
  sbServer,
}) => {
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await openLivePage(page, `${sbServer.url}/Shared`, "Original paragraph.");
    await openLivePage(second, `${sbServer.url}/Shared`, "Original paragraph.");
    await page.locator(".cm-content").click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("First contribution.\n");
    await expect(second.locator(".cm-content")).toContainText(
      "First contribution.",
    );
    await second.locator(".cm-content").click();
    await second.keyboard.press("Control+End");
    await second.keyboard.insertText("Second contribution.\n");
    await expect(page.locator(".cm-content")).toContainText(
      "Second contribution.",
    );
    const expected =
      "Shared notebook\nOriginal paragraph.\nFirst contribution.\nSecond contribution.\n";
    await waitForPersistedContent(sbServer, "Shared.md", expected);
    await expect.poll(() => localContent(page, "Shared.md")).toBe(expected);
    await expect.poll(() => localContent(second, "Shared.md")).toBe(expected);
  } finally {
    await other.close();
  }
});

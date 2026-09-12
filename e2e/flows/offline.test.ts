import { waitForPersistedContent } from "../fixtures/core.ts";
import {
  expect,
  localContent,
  openLivePage,
  test,
} from "../fixtures/offline.ts";

test.use({
  spaceFiles: { "index.md": "Offline notebook", "Draft.md": "Cached draft.\n" },
});
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Playwright offline service-worker emulation is validated in Chromium",
);

test("offline edits survive reload and are saved after reconnecting", async ({
  page,
  context,
  sbServer,
}) => {
  await openLivePage(page, sbServer.url, "Offline notebook");
  await context.setOffline(true);
  await page.goto(`${sbServer.url}/Draft`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".cm-content")).toContainText("Cached draft.");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("Written offline.\n");
  const expected = "Cached draft.\nWritten offline.\n";
  await expect.poll(() => localContent(page, "Draft.md")).toBe(expected);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".cm-content")).toContainText("Written offline.");
  await expect.poll(() => localContent(page, "Draft.md")).toBe(expected);
  await context.setOffline(false);
  await waitForPersistedContent(sbServer, "Draft.md", expected);
  await page.goto(`${sbServer.url}/Draft`);
  await expect(page.locator(".cm-content")).toContainText("Written offline.");
});

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

test("conflicting offline edits preserve both versions until an explicit resolution", async ({
  page,
  context,
  sbServer,
}) => {
  await openLivePage(page, `${sbServer.url}/Shared`, "Original paragraph.");
  await context.setOffline(true);
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.insertText("Local paragraph.");
  await page.keyboard.press("Control+Home");
  await expect
    .poll(() => localContent(page, "Shared.md"))
    .toContain("Local paragraph.");
  const response = await fetch(`${sbServer.url}/.fs/Shared.md`, {
    method: "PUT",
    body: "Shared notebook\nRemote paragraph.\n",
  });
  expect(response.ok).toBe(true);
  await context.setOffline(false);
  await expect(page.locator(".sb-conflict-widget")).toBeVisible();
  await waitForPersistedContent(
    sbServer,
    "Shared.md",
    /Local paragraph\.[\s\S]*Remote paragraph\.|Remote paragraph\.[\s\S]*Local paragraph\./,
  );
  await page
    .getByRole("button", { name: "Accept Version 1", exact: true })
    .click();
  await expect(page.locator(".sb-conflict-widget")).toHaveCount(0);
  const resolved = await page.evaluate(() =>
    (window as any).client.editorView.state.doc.toString(),
  );
  expect(resolved).not.toContain("<<<<<<<");
  expect(resolved).toMatch(/Local paragraph\.|Remote paragraph\./);
  await waitForPersistedContent(sbServer, "Shared.md", resolved);
  await page.goto(`${sbServer.url}/Shared`);
  await expect(page.locator(".cm-editor")).toBeVisible();
  await page.evaluate(() => (window as any).client.widgetsReady);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).client.editorView.state.doc.toString(),
      ),
    )
    .toBe(resolved);
  await expect(page.locator(".sb-conflict-widget")).toHaveCount(0);
  await expect.poll(() => localContent(page, "Shared.md")).toBe(resolved);
});

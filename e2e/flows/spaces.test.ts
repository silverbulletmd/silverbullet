import { adminApi, test } from "../fixtures/authenticated.ts";
import {
  expect,
  gotoSilverBulletPage,
  waitForPersistedContent,
} from "../fixtures/core.ts";
import { openLivePage } from "../fixtures/offline.ts";

test.use({ disableServiceWorker: false });
test.skip(
  ({ browserName }) => browserName !== "chromium" && !process.env.SB_E2E_HOST,
  "Live service-worker space routing is validated in Chromium",
);

test("switching between sibling spaces loads and saves in the selected space", async ({
  adminPage: page,
  sbServer,
}) => {
  await adminApi(page, sbServer, "POST", "spaces", {
    name: "Personal",
    binding: { prefix: "/personal" },
  });
  await adminApi(page, sbServer, "POST", "spaces", {
    name: "Shared",
    binding: { prefix: "/shared" },
  });
  expect(
    (
      await page.request.put(`${sbServer.url}/personal/.fs/index.md`, {
        data: "Personal notebook",
      })
    ).ok(),
  ).toBe(true);
  expect(
    (
      await page.request.put(`${sbServer.url}/shared/.fs/index.md`, {
        data: "Shared notebook",
      })
    ).ok(),
  ).toBe(true);
  const personalServer = { ...sbServer, url: `${sbServer.url}/personal` };
  if (process.env.SB_E2E_HOST) await gotoSilverBulletPage(page, personalServer);
  else await openLivePage(page, personalServer.url, "Personal notebook");
  await page.goto(`${sbServer.url}/.spaces/`);
  await page.getByRole("link").filter({ hasText: "Shared" }).click();
  await expect(page.locator(".cm-content")).toContainText("Shared notebook");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" with an update");
  await waitForPersistedContent(
    { ...sbServer, url: `${sbServer.url}/shared` },
    "index.md",
    "Shared notebook with an update",
    page.request,
  );
  await waitForPersistedContent(
    personalServer,
    "index.md",
    "Personal notebook",
    page.request,
  );
});

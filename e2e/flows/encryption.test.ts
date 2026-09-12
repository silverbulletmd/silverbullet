import { expect, gotoSilverBulletPage, test } from "../fixtures/core.ts";

test.use({
  disableServiceWorker: false,
  serverEnv: { SB_USER: "casey:casey-password" },
});

test("encrypted local data remains usable after reopening the editor", async ({
  page,
  sbServer,
}) => {
  await page.goto(sbServer.url);
  await page.getByLabel("Username", { exact: true }).fill("casey");
  await page.getByLabel("Password", { exact: true }).fill("casey-password");
  await page.locator("#clientEncryption").check();
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.locator(".cm-editor")).toBeVisible();
  await gotoSilverBulletPage(page, sbServer, "PrivateDraft");
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("Saved encrypted browser note.");
  await expect
    .poll(async () =>
      (await page.request.get(`${sbServer.url}/.fs/PrivateDraft.md`)).text(),
    )
    .toBe("Saved encrypted browser note.");
  await gotoSilverBulletPage(page, sbServer, "PrivateDraft");
  await expect(page.locator(".cm-content")).toContainText(
    "Saved encrypted browser note.",
  );
  expect(
    await page.evaluate(() => localStorage.getItem("enableEncryption")),
  ).toBe("true");
  const stored = await page.evaluate(async () => {
    const rows: unknown[] = [];
    for (const info of await indexedDB.databases()) {
      if (!info.name?.startsWith("sb_data_")) continue;
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(info.name!);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        for (const name of database.objectStoreNames) {
          const store = database.transaction(name).objectStore(name);
          for (const request of [store.getAllKeys(), store.getAll()]) {
            rows.push(
              await new Promise((resolve, reject) => {
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
              }),
            );
          }
        }
      } finally {
        database.close();
      }
    }
    return JSON.stringify(rows);
  });
  expect(stored.length).toBeGreaterThan(100);
  expect(stored).not.toContain("PrivateDraft");
});

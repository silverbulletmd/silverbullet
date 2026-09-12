import { adminApi, test } from "../fixtures/authenticated.ts";
import { expect } from "../fixtures/core.ts";
import { openLivePage } from "../fixtures/offline.ts";

test.use({ disableServiceWorker: false });
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Live service-worker logout is validated in Chromium",
);

test("failed saving preserves edits until explicit force logout deletes local data", async ({
  adminPage: page,
  sbServer,
  context,
}) => {
  const base = sbServer.url;
  await adminApi(page, sbServer, "POST", "spaces", {
    name: "Notebook",
    binding: { prefix: "/" },
    public: true,
  });
  await page.request.put(`${base}/.fs/index.md`, {
    data: "Notebook for recovery",
  });
  await openLivePage(page, base, "Notebook for recovery");
  await page.goto(`${base}/.spaces/`);
  const editor = await context.newPage();
  await editor.goto(`${base}/RecoveryDraft`);
  await expect(editor.locator("#sb-editor .cm-editor")).toBeVisible();
  await editor.evaluate(() => (window as any).client.widgetsReady);
  await editor.evaluate(() => {
    const client = (window as any).client;
    client.contentManager.save = async () => {
      throw new Error("Synthetic storage failure");
    };
    const view = client.editorView;
    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: "Keep this unsaved draft available for recovery",
      },
    });
    clearTimeout(client.contentManager.saveTimeout);
  });
  await page.getByRole("button", { name: "Profile menu", exact: true }).click();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Force logout", exact: true }),
  ).toBeVisible();
  expect((await page.request.get(`${base}/.spaces/api/session`)).status()).toBe(
    200,
  );
  await expect(editor).toHaveURL(`${base}/RecoveryDraft`);
  expect(await editor.evaluate(() => document.documentElement.inert)).toBe(
    false,
  );
  await expect(editor.locator("#sb-editor .cm-content")).toContainText(
    "Keep this unsaved draft available for recovery",
  );
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await indexedDB.databases()).filter((db) =>
            db.name?.startsWith("sb_"),
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Force logout", exact: true }).click();
  await expect(
    page.getByText("Local space data has been removed from this browser."),
  ).toBeVisible();
  await expect(
    editor.getByText("Local space data has been removed from this browser."),
  ).toBeVisible();
  expect((await page.request.get(`${base}/.spaces/api/session`)).status()).toBe(
    401,
  );
  await expect
    .poll(() =>
      page.evaluate(async () =>
        (await indexedDB.databases()).filter((db) =>
          db.name?.startsWith("sb_"),
        ),
      ),
    )
    .toEqual([]);
});

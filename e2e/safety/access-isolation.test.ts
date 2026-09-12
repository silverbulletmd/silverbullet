import { adminApi, login, test } from "../fixtures/authenticated.ts";
import {
  expect,
  gotoSilverBulletPage,
  waitForEditorReady,
} from "../fixtures/core.ts";

test("a read-only member cannot write or enter another space or administration", async ({
  adminPage: page,
  sbServer,
}) => {
  await adminApi(page, sbServer, "POST", "users", {
    username: "reader",
    password: "reader-password",
  });
  await adminApi(page, sbServer, "POST", "spaces", {
    name: "Readable",
    binding: { prefix: "/readable" },
    members: { reader: { role: "read" } },
  });
  await adminApi(page, sbServer, "POST", "spaces", {
    name: "Private",
    binding: { prefix: "/private" },
  });
  const path = `${sbServer.url}/readable/.fs/Note.md`;
  expect(
    (
      await page.request.put(path, {
        data: "Original note.\n* [ ] Pending task\n",
      })
    ).ok(),
  ).toBe(true);
  await page.context().clearCookies();
  await login(page, sbServer, "reader", "reader-password");
  await expect(page.getByText("Readable", { exact: true })).toBeVisible();
  await expect(page.getByText("Private", { exact: true })).toHaveCount(0);
  await gotoSilverBulletPage(
    page,
    { ...sbServer, url: `${sbServer.url}/readable` },
    "Note",
  );
  await waitForEditorReady(page);
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("Forbidden edit");
  await expect(page.locator(".cm-content")).not.toContainText("Forbidden edit");
  expect(
    (await page.request.put(path, { data: "Forbidden edit" })).status(),
  ).toBe(403);
  expect(await (await page.request.get(path)).text()).toBe(
    "Original note.\n* [ ] Pending task\n",
  );
  expect(
    (await page.request.get(`${sbServer.url}/private/.fs/Note.md`)).status(),
  ).toBe(403);
  await page.goto(`${sbServer.url}/.spaces/admin`);
  await expect(
    page.getByRole("heading", { name: "Not found", exact: true }),
  ).toBeVisible();
  expect(
    (
      await page.request.get(`${sbServer.url}/.spaces/api/admin/users`)
    ).status(),
  ).toBe(403);
});

import { adminApi, login, test } from "../fixtures/authenticated.ts";
import {
  expect,
  gotoSilverBulletPage,
  waitForPersistedContent,
} from "../fixtures/core.ts";

test("a member signs in, edits their space and signs out", async ({
  adminPage: page,
  sbServer,
}) => {
  await adminApi(page, sbServer, "POST", "users", {
    username: "casey",
    password: "casey-password",
    fullName: "Casey Example",
  });
  await adminApi(page, sbServer, "POST", "spaces", {
    name: "Notebook",
    binding: { prefix: "/notes" },
    members: { casey: { role: "write" } },
  });
  await page.context().clearCookies();
  await login(page, sbServer, "casey", "casey-password");
  await expect(page.getByText("Notebook", { exact: true })).toBeVisible();
  await gotoSilverBulletPage(
    page,
    { ...sbServer, url: `${sbServer.url}/notes` },
    "Draft",
  );
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("A saved member note.");
  await waitForPersistedContent(
    { ...sbServer, url: `${sbServer.url}/notes` },
    "Draft.md",
    "A saved member note.",
    page.request,
  );
  const profile = page.locator("#sb-top button:has(.sb-profile-avatar)");
  await profile.click();
  await expect(page.getByText("Casey Example", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Log out", exact: true }).click();
  await expect
    .poll(async () =>
      (
        await page.request.get(`${sbServer.url}/.dashboard/api/session`)
      ).status(),
    )
    .toBe(401);
  await expect(
    page.getByRole("heading", { name: "You are signed out" }),
  ).toBeVisible();
});

import { adminApi, login, test } from "../fixtures/authenticated.ts";
import {
  expect,
  gotoSilverBulletPage,
  waitForPersistedContent,
} from "../fixtures/core.ts";

test("an administrator creates a space, saves its settings and opens it", async ({
  page,
  sbServer,
}) => {
  await login(page, sbServer);
  await page.getByRole("link", { name: "Add space", exact: true }).click();
  await page.getByLabel("Name", { exact: true }).fill("Notebook");
  await page.getByLabel("Prefix", { exact: true }).fill("/notes");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).not.toHaveURL(/\/new$/);
  await expect(
    page.getByRole("button", { name: "Save changes", exact: true }),
  ).toBeVisible();
  const settingsUrl = page.url();
  await page.getByLabel("Name", { exact: true }).fill("Team Notebook");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.goto(settingsUrl);
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue(
    "Team Notebook",
  );
  await gotoSilverBulletPage(
    page,
    { ...sbServer, url: `${sbServer.url}/notes` },
    "Welcome",
  );
  await page.locator(".cm-content").click();
  await page.keyboard.insertText("A new shared notebook.");
  await waitForPersistedContent(
    { ...sbServer, url: `${sbServer.url}/notes` },
    "Welcome.md",
    "A new shared notebook.",
    page.request,
  );
});

test("an administrator creates a member and saves a space grant", async ({
  adminPage: page,
  sbServer,
}) => {
  await page.goto(`${sbServer.url}/.spaces/users/new`);
  await page.getByLabel("Username", { exact: true }).fill("casey");
  await page.getByLabel("Password", { exact: true }).fill("casey-password");
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await expect(page).toHaveURL(/\/\.spaces\/users\/casey/);
  const space = await adminApi<{ id: string }>(
    page,
    sbServer,
    "POST",
    "spaces",
    {
      name: "Notebook",
      binding: { prefix: "/notes" },
    },
  );
  await page.goto(`${sbServer.url}/.spaces/${space.id}?section=access`);
  await page
    .getByRole("checkbox", { name: "casey: Write", exact: true })
    .check();
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("Saved");
  await page.reload();
  await expect(
    page.getByRole("checkbox", { name: "casey: Write", exact: true }),
  ).toBeChecked();
  const saved = await adminApi(page, sbServer, "GET", `spaces/${space.id}`);
  expect(saved.members.casey.role).toBe("write");
});

import { adminApi, login, test } from "../fixtures/authenticated.ts";
import {
  expect,
  gotoSilverBulletPage,
  waitForPersistedContent,
} from "../fixtures/core.ts";

const hostnameTest = process.env.SB_E2E_HOST
  ? test
  : test.extend({
      launchOptions: {
        args: [
          "--disable-dev-shm-usage",
          "--host-resolver-rules=MAP team.localhost 127.0.0.1",
        ],
      },
    });
hostnameTest.skip(
  ({ browserName }) => browserName !== "chromium" && !process.env.SB_E2E_HOST,
  "The fixture hostname mapping uses Chromium; set SB_E2E_HOST for other browsers.",
);

hostnameTest(
  "an administrator reuses a hostname for sibling spaces, edits and opens them",
  async ({ page, sbServer }) => {
    await login(page, sbServer);
    await adminApi(page, sbServer, "PUT", "server-config", {
      primaryUrl: sbServer.url,
    });
    const primaryRoot = await adminApi<{ id: string }>(
      page,
      sbServer,
      "POST",
      "spaces",
      {
        name: "Primary Root",
        binding: { host: `127.0.0.1:${sbServer.port}` },
      },
    );
    await page.reload();
    await page.getByRole("link", { name: "Create space", exact: true }).click();
    const primaryOption = page
      .getByLabel("Hostname", { exact: true })
      .locator('option[value="primary"]');
    await expect(primaryOption).toHaveText(/Primary hostname .* — \/$/);
    await expect(primaryOption).toBeDisabled();
    await expect(
      page
        .getByLabel("Hostname", { exact: true })
        .locator(`option[value="host:127.0.0.1:${sbServer.port}"]`),
    ).toHaveCount(0);
    await adminApi(page, sbServer, "DELETE", `spaces/${primaryRoot.id}`);
    await page.reload();
    await page.getByLabel("Name", { exact: true }).fill("Draft");
    await page.getByLabel("Hostname", { exact: true }).selectOption("new");
    await page
      .getByLabel("New hostname", { exact: true })
      .fill(`team.localhost:${sbServer.port}`);
    await page.getByLabel("Name", { exact: true }).fill("Work");
    await page.getByLabel("Hostname", { exact: true }).selectOption("primary");
    await expect(page.getByLabel("Path", { exact: true })).toHaveValue("/work");
    await page.getByLabel("Hostname", { exact: true }).selectOption("new");
    await expect(page.getByLabel("New hostname", { exact: true })).toHaveValue(
      `team.localhost:${sbServer.port}`,
    );
    await page.getByLabel("Path", { exact: true }).fill("/work");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).not.toHaveURL(/\/new$/);
    const workId = decodeURIComponent(
      new URL(page.url()).pathname.split("/").pop()!,
    );
    await adminApi(page, sbServer, "PATCH", `spaces/${workId}`, {
      access: "write",
    });

    await page.goto(`${sbServer.url}/.dashboard/`);
    await page.getByRole("link", { name: "Create space", exact: true }).click();
    await page.getByLabel("Name", { exact: true }).fill("Wiki");
    const knownHost = page
      .getByLabel("Hostname", { exact: true })
      .locator("option", {
        hasText: `team.localhost:${sbServer.port} — /work`,
      });
    await expect(knownHost).toHaveText(
      `team.localhost:${sbServer.port} — /work`,
    );
    await expect(knownHost).toBeEnabled();
    await page
      .getByLabel("Hostname", { exact: true })
      .selectOption(`host:team.localhost:${sbServer.port}`);
    await page.getByLabel("Path", { exact: true }).fill("/wiki");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    await expect(page).not.toHaveURL(/\/new$/);
    const wikiId = decodeURIComponent(
      new URL(page.url()).pathname.split("/").pop()!,
    );
    await adminApi(page, sbServer, "PATCH", `spaces/${wikiId}`, {
      access: "write",
    });

    await page.getByLabel("Path", { exact: true }).fill("/docs");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    const wiki = await adminApi<any>(page, sbServer, "GET", `spaces/${wikiId}`);
    expect(wiki.binding).toEqual({
      host: `team.localhost:${sbServer.port}`,
      prefix: "/docs",
    });

    const teamServer = {
      ...sbServer,
      url: `http://team.localhost:${sbServer.port}`,
    };
    expect(
      (
        await page.request.put(`${teamServer.url}/work/.fs/Identity.md`, {
          data: "Work space identity",
        })
      ).ok(),
    ).toBe(true);
    expect(
      (
        await page.request.put(`${teamServer.url}/docs/.fs/Identity.md`, {
          data: "Wiki space identity",
        })
      ).ok(),
    ).toBe(true);
    await gotoSilverBulletPage(
      page,
      { ...teamServer, url: `${teamServer.url}/work` },
      "Identity",
    );
    await expect(page.locator(".cm-content")).toContainText(
      "Work space identity",
    );
    await page.locator(".cm-content").click();
    await page.keyboard.insertText("A new shared workspace.");
    await waitForPersistedContent(
      { ...teamServer, url: `${teamServer.url}/work` },
      "Identity.md",
      "Work space identityA new shared workspace.",
      page.request,
    );
    await gotoSilverBulletPage(
      page,
      { ...teamServer, url: `${teamServer.url}/docs` },
      "Identity",
    );
    await expect(page).toHaveURL(`${teamServer.url}/docs/Identity`);
    await expect(page.locator(".cm-content")).toContainText(
      "Wiki space identity",
    );
  },
);

test("an administrator creates a member and saves a space grant", async ({
  adminPage: page,
  sbServer,
}) => {
  await page.goto(`${sbServer.url}/.dashboard/users/new`);
  await page.getByLabel("Username", { exact: true }).fill("casey");
  await page.getByLabel("Password", { exact: true }).fill("casey-password");
  await page.getByRole("button", { name: "Create user", exact: true }).click();
  await expect(page).toHaveURL(/\/\.dashboard\/users\/casey/);
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
  await page.goto(`${sbServer.url}/.dashboard/${space.id}?section=access`);
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

import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { ADMIN_PASSWORD, ADMIN_USER, expect, test } from "../fixtures/core.ts";

// End-to-end coverage of the first-run setup wizard. Both scenarios reuse the
// `sbServer` fixture, which spawns the debug server on a fresh, empty temp dir.
// The fixture defaults to `--single` (so most tests get a servable space), so
// opt out here: with `singleSpace: false` the empty temp dir boots into
// "setup" mode and puts up the wizard at `/.setup/`. `SB_DISABLE_SERVICE_WORKER=1`
// and `SB_RUNTIME_API=0` are set by the fixture (see fixtures/core.ts).
test.use({ singleSpace: false });

/**
 * Fill the wizard's admin step and advance. Field ids come from
 * `client/spaces_ui/components/Wizard.tsx`.
 */
async function fillAdminStep(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "Welcome to SilverBullet" }),
  ).toBeVisible();
  await page.locator("#setup-username").fill(username);
  await page.locator("#setup-password").fill(password);
  await page.locator("#setup-password2").fill(password);
  await page.getByRole("button", { name: "Continue" }).click();
}

/**
 * Poll `/.spaces` until the live router has swapped from the setup wizard
 * into the multi-space stack. Before the swap the wizard's fallback redirects
 * every non-`/.setup` path (307 → `/.setup/`); after it, the spaces shell
 * answers 200. `/.spaces` is a reserved prefix served ahead of space dispatch,
 * so this discriminator holds even when a space is bound at the root (which
 * would otherwise shadow `/.setup/*` with its own SPA shell). `redirect:
 * "manual"` keeps the pre-swap 307 visible instead of following it to a 200.
 * Generous timeout: the swap boots the whole multi stack on a background
 * task.
 */
async function waitForHotSwap(baseUrl: string): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const r = await fetch(`${baseUrl}/.spaces`, {
            redirect: "manual",
          });
          return r.status;
        } catch {
          return 0; // mid-swap: port briefly unreachable
        }
      },
      { timeout: 45_000, intervals: [500, 1000] },
    )
    .toBe(200);
}

/** Log in on the unified `/.spaces` UI (shares LoginForm with `.auth`). */
async function loginToAdmin(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

test("wizard provisions a hostname-prefix space with selected revisions mode", async ({
  sbServer,
  page,
}) => {
  test.setTimeout(120_000);
  const setupUrl = `http://localhost:${sbServer.port}`;
  await page.goto(`${setupUrl}/`);
  await fillAdminStep(page, ADMIN_USER, ADMIN_PASSWORD);
  await expect(page.getByLabel("Server URL", { exact: true })).toHaveValue(
    setupUrl,
  );
  await page.getByLabel("Hostname", { exact: true }).selectOption("new");
  await page
    .getByLabel("New hostname", { exact: true })
    .fill(`127.0.0.1:${sbServer.port}`);
  await expect(
    page.getByText("✓ hostname reaches this server", { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("New hostname", { exact: true })
    .fill("notes.localhost");
  await page.getByLabel("Path", { exact: true }).fill("/notes");
  await expect(page.locator(".sb-url-affix")).toHaveText(
    "http://notes.localhost",
  );
  await expect(page.locator("output")).toHaveCount(0);
  await expect(page.getByLabel("Revisions")).toHaveValue("managed");
  await page.getByLabel("Revisions").selectOption("unmanaged");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await waitForHotSwap(setupUrl);
  await page.goto(`${setupUrl}/.spaces`);
  await loginToAdmin(page, ADMIN_USER, ADMIN_PASSWORD);
  await expect(page.locator(".sb-space-list")).toContainText("Notes");
  await access(join(sbServer.spaceDir, "spaces", "notes", "index.md"));
  const serverConfig = JSON.parse(
    await readFile(join(sbServer.spaceDir, "server.json"), "utf8"),
  );
  expect(serverConfig.primaryUrl).toBe(setupUrl);
  const spacesConfig = JSON.parse(
    await readFile(join(sbServer.spaceDir, "spaces.json"), "utf8"),
  );
  const space = Object.values(spacesConfig)[0] as {
    binding: { host: string; prefix: string };
    revisions: string;
  };
  expect(space.binding).toEqual({ host: "notes.localhost", prefix: "/notes" });
  expect(space.revisions).toBe("unmanaged");
  expect((await page.request.get(`${setupUrl}/.setup/`)).status()).toBe(404);
});

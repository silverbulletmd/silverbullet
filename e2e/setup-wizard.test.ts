import { access } from "node:fs/promises";
import { join } from "node:path";
import type { Browser, Page } from "@playwright/test";
import type { SBServer } from "./fixtures";
import { ADMIN_PASSWORD, ADMIN_USER, expect, test } from "./fixtures";

// End-to-end coverage of the first-run setup wizard. Both scenarios reuse the
// `sbServer` fixture, which spawns the debug server on a fresh, empty temp dir.
// The fixture defaults to `--single` (so most tests get a servable space), so
// opt out here: with `singleSpace: false` the empty temp dir boots into
// "setup" mode and puts up the wizard at `/.setup/`. `SB_DISABLE_SERVICE_WORKER=1`
// and `SB_RUNTIME_API=0` are set by the fixture (see fixtures.ts).
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
async function waitForHotSwap(sbServer: SBServer): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const r = await fetch(`${sbServer.url}/.spaces`, {
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

/** Log in on a space's own login page (the Core client login, `#username`). */
async function loginToSpace(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await expect(page.locator("#username")).toBeVisible({ timeout: 30_000 });
  await page.locator("#username").fill(username);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
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

test("wizard provisions a root space, then the server serves it", async ({
  sbServer,
  page,
}) => {
  // Generous budget: the hot-swap boots the whole multi stack, then we log in
  // to the space and the admin UI.
  test.setTimeout(120_000);

  // A fresh server points every path at the wizard.
  await page.goto(`${sbServer.url}/`);
  await expect(page).toHaveURL(/\/\.setup\/$/);

  // Admin step.
  await fillAdminStep(page, ADMIN_USER, ADMIN_PASSWORD);

  // Space step: defaults are name "Notes", folder derived from the name, and
  // hosting defaults to a URL prefix — so this "root space" scenario selects
  // the root radio explicitly.
  await expect(
    page.getByRole("heading", { name: "Create your first space" }),
  ).toBeVisible();
  await expect(page.locator("#setup-space-name")).toHaveValue("Notes");
  await page
    .getByRole("radio", { name: /Host at the root of this server/ })
    .check();
  // The folder is now prepopulated with an absolute path under the server's
  // data root ending in the slug-derived spaces/<slug> (not a random
  // spaces/<uuid>).
  await expect(page.locator("#setup-folder")).toHaveValue(/\/spaces\/notes$/);
  await page.getByRole("button", { name: "Finish setup" }).click();

  // The wizard's done step shows "Setup complete" and then auto-navigates as
  // soon as the server hot-swaps into multi mode — too fast to assert on the
  // transient heading, so wait on the swap itself (server-side) instead.
  await waitForHotSwap(sbServer);

  // The root space is private, so hitting `/` lands on its login page; logging
  // in with the admin account loads the editor shell. (The wizard's own
  // `/.setup/*` surface can't be probed for absence here — the root space
  // shadows it with its SPA shell — so scenario 2, with an unbound root,
  // covers "the setup surface is gone".)
  await page.goto(`${sbServer.url}/`);
  await loginToSpace(page, ADMIN_USER, ADMIN_PASSWORD);
  await expect(page.locator("#sb-editor .cm-editor")).toBeVisible({
    timeout: 30_000,
  });

  // The space login established the shared server session, so the unified
  // spaces UI opens directly without asking this administrator to log in
  // again.
  await page.goto(`${sbServer.url}/.spaces`);
  await expect(page.locator(".sb-space-list")).toContainText("Notes");

  // And the space folder on disk is the slug-derived spaces/notes (with its
  // seeded index page), not a random spaces/<uuid>. `access` rejects if the
  // path is missing, failing the test.
  await access(join(sbServer.spaceDir, "spaces", "notes", "index.md"));
});

test("wizard with a URL prefix; setup surface is gone afterwards", async ({
  sbServer,
  page,
  browser,
}: {
  sbServer: SBServer;
  page: Page;
  browser: Browser;
}) => {
  test.setTimeout(120_000);

  await page.goto(`${sbServer.url}/`);
  await expect(page).toHaveURL(/\/\.setup\/$/);

  await fillAdminStep(page, ADMIN_USER, ADMIN_PASSWORD);

  // Space step: host under a URL prefix (defaults to /notes).
  await expect(
    page.getByRole("heading", { name: "Create your first space" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Host under a URL prefix" }).check();
  await expect(page.locator("#setup-prefix")).toHaveValue("/notes");
  await page.getByRole("button", { name: "Finish setup" }).click();

  // Wait on the server-side hot-swap rather than the transient "Setup
  // complete" heading (the wizard auto-navigates away the moment it swaps).
  await waitForHotSwap(sbServer);

  // A fresh browser context (no wizard session) confirms the setup surface is
  // gone: `/.setup/` is no longer served — the multi dispatcher answers 404
  // ("No space here"), while `/` becomes the account-facing space index
  // because this setup put its first space at /notes rather than at root.
  const ctx = await browser.newContext();
  try {
    const fresh = await ctx.newPage();
    const setupResp = await fresh.goto(`${sbServer.url}/.setup/`);
    expect(setupResp?.status()).toBe(404);
    await expect(fresh.locator("body")).toContainText("No space here");

    await fresh.goto(`${sbServer.url}/`);
    await expect(fresh).toHaveURL(/\/\.spaces\/login/);
    // The unified `/.spaces/login` screen serves every account, not just
    // admins (see client/spaces_ui/components/Login.tsx), so its default
    // heading is just the app name.
    await expect(
      fresh.getByRole("heading", { name: "SilverBullet" }),
    ).toBeVisible();
    await fresh.fill("#username", ADMIN_USER);
    await fresh.fill("#password", ADMIN_PASSWORD);
    await fresh.getByRole("button", { name: "Log in" }).click();
    await expect(fresh.locator(".sb-tab.sb-active")).toHaveText("Spaces");
    await expect(fresh.locator(".sb-space-list")).toContainText("Notes");
  } finally {
    await ctx.close();
  }

  // And the space really was provisioned at /notes.
  await page.goto(`${sbServer.url}/.spaces`);
  await loginToAdmin(page, ADMIN_USER, ADMIN_PASSWORD);
  await expect(page.locator(".sb-space-list")).toContainText("Notes");
  await expect(page.locator(".sb-space-list")).toContainText("/notes");
});

test("wizard's folder picker is driven by the fs/dirs endpoint", async ({
  sbServer,
  page,
}) => {
  await page.goto(`${sbServer.url}/`);
  await expect(page).toHaveURL(/\/\.setup\/$/);

  await fillAdminStep(page, ADMIN_USER, ADMIN_PASSWORD);
  await expect(
    page.getByRole("heading", { name: "Create your first space" }),
  ).toBeVisible();

  // The folder picker is now always visible (no checkbox to reveal it).
  // Typing a path drives a debounced GET /.setup/api/fs/dirs; an absent
  // directory (relative paths resolve under the data root) reports "will be
  // created" in the picker's status line.
  await page.locator("#setup-folder").fill("imported-notes");
  await expect(page.locator(".sb-folder-picker-status")).toContainText(
    "will be created",
    { timeout: 5000 },
  );
});

test("the setup wizard's styles actually load", async ({ page, sbServer }) => {
  await page.goto(`${sbServer.url}/.setup/`);
  const button = page.locator("button").first();
  await button.waitFor({ state: "visible" });
  // Assert a COMPUTED style, not that the page rendered. If the stylesheet
  // 404s or fails to resolve against <base>, the page still renders — with
  // browser-default buttons. Only the resolved colour proves it loaded.
  const bg = await button.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(bg).toBe("rgb(70, 76, 252)"); // --ui-accent-color #464cfc
});

import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
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

test("wizard provisions a prefix space with selected revisions mode", async ({
  sbServer,
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(`${sbServer.url}/`);
  await fillAdminStep(page, ADMIN_USER, ADMIN_PASSWORD);
  await expect(page.getByLabel("Primary URL", { exact: true })).toHaveValue(
    sbServer.url,
  );
  await expect(page.getByLabel("Binding")).toHaveValue("prefix");
  await expect(page.locator("#setup-prefix")).toHaveValue("/notes");
  await expect(page.getByLabel("Revisions")).toHaveValue("managed");
  await page.getByLabel("Revisions").selectOption("unmanaged");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await waitForHotSwap(sbServer);
  await page.goto(`${sbServer.url}/.spaces`);
  await loginToAdmin(page, ADMIN_USER, ADMIN_PASSWORD);
  await expect(page.locator(".sb-space-list")).toContainText("Notes");
  await access(join(sbServer.spaceDir, "spaces", "notes", "index.md"));
  const serverConfig = JSON.parse(
    await readFile(join(sbServer.spaceDir, "server.json"), "utf8"),
  );
  expect(serverConfig.primaryUrl).toBe(sbServer.url);
  const spacesConfig = JSON.parse(
    await readFile(join(sbServer.spaceDir, "spaces.json"), "utf8"),
  );
  const space = Object.values(spacesConfig)[0] as {
    binding: { prefix: string };
    revisions: string;
  };
  expect(space.binding).toEqual({ prefix: "/notes" });
  expect(space.revisions).toBe("unmanaged");
  expect((await page.request.get(`${sbServer.url}/.setup/`)).status()).toBe(
    404,
  );
});

test("wizard permits a first space on the primary hostname", async ({
  sbServer,
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto(`${sbServer.url}/`);
  await fillAdminStep(page, ADMIN_USER, ADMIN_PASSWORD);
  await page.getByLabel("Binding").selectOption("host");
  const hostname = new URL(sbServer.url).hostname;
  await page.getByLabel("Hostname").fill(hostname);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await waitForHotSwap(sbServer);
  const spacesConfig = JSON.parse(
    await readFile(join(sbServer.spaceDir, "spaces.json"), "utf8"),
  );
  const space = Object.values(spacesConfig)[0] as {
    binding: { host: string };
    revisions: string;
  };
  expect(space.binding).toEqual({ host: hostname });
  expect(space.revisions).toBe("managed");
  await page.goto(`${sbServer.url}/`);
  await page.locator("#username").fill(ADMIN_USER);
  await page.locator("#password").fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator("#sb-editor .cm-editor")).toBeVisible({
    timeout: 30_000,
  });
  await page.goto(`${sbServer.url}/.spaces`);
  await expect(page.locator(".sb-space-list")).toContainText("Notes");
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

  // Typing a folder path triggers a debounced directory lookup. An absent
  // directory should report that it will be created.
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
  expect(bg).toBe("rgb(53, 105, 184)"); // --ui-accent-color #3569b8
});

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  getFreePort,
  waitForEditorReady,
  waitForServer,
} from "./fixtures";

let proc: ChildProcess;
let rootDir: string;
let base: string;

const BIN = "./target/debug/silverbullet";
const CWD = join(import.meta.dirname, "..");

test.beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "sb-multi-e2e-"));

  // Provision the root the same way an operator would non-interactively: the
  // `setup` subcommand (the scriptable twin of the /.setup wizard) writes
  // users.json (the admin account) + an empty spaces.json. That spaces.json is
  // what makes the server boot into multi-space mode; SB_MULTI_SPACE is gone
  // and setting SB_USER alongside spaces.json now refuses to boot.
  execFileSync(
    BIN,
    [
      "setup",
      rootDir,
      "--admin",
      `${ADMIN_USER}:${ADMIN_PASSWORD}`,
      // No --space: start with an empty server and create the first space
      // through the admin UI below (what this test exercises).
    ],
    { cwd: CWD, stdio: "pipe" },
  );

  const port = await getFreePort();
  proc = spawn(BIN, [rootDir, "-p", String(port), "-L", "127.0.0.1"], {
    cwd: CWD,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // See fixtures.ts: with the service worker disabled and `?headless=1` on
      // navigation, the client uses its own in-page runtime, so the server
      // never needs to spawn a headless Chrome for the runtime API.
      SB_RUNTIME_API: "0",
      SB_DISABLE_SERVICE_WORKER: "1",
    },
  });
  base = `http://127.0.0.1:${port}`;
  await waitForServer(`${base}/.spaces`);
});

test.afterAll(async () => {
  proc?.kill();
  await rm(rootDir, { recursive: true, force: true });
});

test("first run: login, create a space, open it, edit a page", async ({
  page,
}) => {
  // With no root-bound space, / redirects (307) to the unified `/.spaces`
  // surface, which then bounces an unauthenticated visitor to its login
  // screen.
  await page.goto(`${base}/`);
  await expect(page).toHaveURL(/\/\.spaces\/login/);

  // Log in with the admin account created by `setup`.
  await page.getByLabel("Username").fill(ADMIN_USER);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();

  // Empty list -> create a space on its own URL.
  await expect(page.getByText("No spaces yet")).toBeVisible();
  await page.getByRole("link", { name: "Create space" }).click();
  await expect(page).toHaveURL(`${base}/.spaces/new`);
  await page.getByLabel("Name").fill("Playground");
  // The binding-value input's label is dynamic ("Prefix"/"Hostname") and
  // defaults to "Prefix" for the default "URL prefix" binding type.
  await page.getByLabel("Prefix").fill("/play");
  // Folder picker (shared spaces_ui/FolderPicker.tsx): default value tracks
  // the slugified name, and its "Browse…" control is present.
  await expect(page.locator("#space-folder")).toHaveValue("spaces/playground");
  await expect(page.getByRole("button", { name: "Browse…" })).toBeVisible();
  // Access model is public/members now (no more per-space auth dropdown). Make
  // it public so the space opens below without a separate space login. The
  // toggle lives under "Advanced", which is collapsed by default.
  await page.locator("summary", { hasText: "Advanced" }).click();
  await page.getByLabel("Public (no login required)").check();
  await page.getByRole("button", { name: "Create" }).click();

  // Creation lands on the stable detail route. Return to the list to inspect
  // its runtime status and open the space.
  await expect(page).toHaveURL(/\/\.spaces\/[^/]+$/);
  await page.getByRole("link", { name: "Spaces" }).click();

  // It shows as running.
  await expect(page.getByText("Playground")).toBeVisible();
  await expect(page.locator(".sb-badge.running")).toBeVisible();

  // Open the space and verify the editor loads. Mirror the boot conventions
  // from e2e/first-load.test.ts / fixtures.ts: navigate with `?headless=1`
  // (so the server doesn't need a headless-Chrome runtime API), wait for
  // `#sb-editor .cm-editor` to be visible, then wait for the client runtime
  // to report ready before interacting with the page.
  await page.goto(`${base}/play/?headless=1`);
  await page
    .locator("#sb-editor .cm-editor")
    .waitFor({ state: "visible", timeout: 30_000 });
  await waitForEditorReady(page);

  // Type into the page and confirm content sticks.
  const editor = page.locator("#sb-editor .cm-content");
  await editor.click();
  await page.keyboard.type("Hello from multi-space");
  await expect(editor).toContainText("Hello from multi-space");
});

import { expect, test } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort, waitForServer } from "./fixtures";

// Regression test: on the FIRST-ever visit to an authenticated space (empty
// localStorage, no session), the boot fetches all 401 and the client redirects
// to the login page. The redirect used to abort the sibling in-flight boot
// fetches, which were then misclassified as "offline" and surfaced a spurious
// "Could not process config and no cached copy" alert right before the login
// page appeared.

let proc: ChildProcess;
let spaceDir: string;
let base: string;

test.beforeAll(async () => {
  spaceDir = await mkdtemp(join(tmpdir(), "sb-auth-e2e-"));
  const port = await getFreePort();
  proc = spawn(
    "./target/debug/silverbullet",
    [spaceDir, "-p", String(port), "-L", "127.0.0.1"],
    {
      cwd: join(import.meta.dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SB_USER: "alice:s3cret",
        SB_RUNTIME_API: "0",
        SB_DISABLE_SERVICE_WORKER: "1",
      },
    },
  );
  base = `http://127.0.0.1:${port}`;
  // The SPA shell is served openly, so /.ping answers even without a session.
  await waitForServer(`${base}/.ping`);
});

test.afterAll(async () => {
  proc?.kill();
  await rm(spaceDir, { recursive: true, force: true });
});

test("first load of an authenticated space redirects to login without alerts", async ({
  page,
}) => {
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.dismiss();
  });

  await page.goto(`${base}/`);
  // The boot code discovers it is unauthenticated and redirects to the login
  // page.
  await expect(page.locator("#username")).toBeVisible({ timeout: 30_000 });
  // Give any straggling (aborted) boot fetch time to surface a dialog.
  await page.waitForTimeout(1500);
  expect(dialogs, `unexpected dialogs: ${dialogs.join(" | ")}`).toEqual([]);

  // And logging in still works end to end.
  await page.locator("#username").fill("alice");
  await page.locator("#password").fill("s3cret");
  await page.getByRole("button", { name: "Log in" }).click();
  await page.waitForURL(`${base}/`);
  await expect(page.locator("#sb-editor .cm-editor")).toBeVisible({
    timeout: 30_000,
  });
  expect(dialogs, `unexpected dialogs: ${dialogs.join(" | ")}`).toEqual([]);
});

test("the login page's styles actually load", async ({ page }) => {
  await page.goto(`${base}/`);
  // auth.html has a second <button id="togglePassword"> for show/hide, so
  // take the last match — the submit button inside #login.
  const button = page
    .locator("#login button[type=submit], #login button")
    .last();
  await button.waitFor({ state: "visible" });
  const bg = await button.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(bg).toBe("rgb(70, 76, 252)"); // --ui-accent-color #464cfc
});

import { expect, test } from "@playwright/test";
import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getFreePort, waitForEditorReady, waitForServer } from "./fixtures";

let proc: ChildProcess;
let rootDir: string;
let base: string;

test.beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "sb-multi-e2e-"));
  const port = await getFreePort();
  proc = spawn(
    "./target/debug/silverbullet",
    [rootDir, "-p", String(port), "-L", "127.0.0.1"],
    {
      cwd: join(import.meta.dirname, ".."),
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SB_MULTI_SPACE: "1",
        SB_USER: "admin:adminpw",
        // See fixtures.ts: with the service worker disabled and
        // `?headless=1` on navigation, the client uses its own in-page
        // runtime, so the server never needs to spawn a headless
        // Chrome for the runtime API.
        SB_RUNTIME_API: "0",
        SB_DISABLE_SERVICE_WORKER: "1",
      },
    },
  );
  base = `http://127.0.0.1:${port}`;
  await waitForServer(`${base}/.admin/`);
});

test.afterAll(async () => {
  proc?.kill();
  await rm(rootDir, { recursive: true, force: true });
});

test("first run: login, create a space, open it, edit a page", async ({
  page,
}) => {
  // Root redirects to the admin UI on a fresh server.
  await page.goto(`${base}/`);
  await expect(page).toHaveURL(/\/\.admin\//);

  // Log in.
  await page.getByLabel("Username").fill("admin");
  await page.getByLabel("Password").fill("adminpw");
  await page.getByRole("button", { name: "Log in" }).click();

  // Empty list -> create a space.
  await expect(page.getByText("No spaces yet")).toBeVisible();
  await page.getByRole("button", { name: "Create space" }).click();
  await page.getByLabel("Name").fill("Playground");
  // The binding-value input's label is dynamic ("Prefix"/"Hostname")
  // and defaults to "Prefix" for the default "URL prefix" binding type.
  await page.getByLabel("Prefix").fill("/play");
  await page.getByLabel("Authentication").selectOption("none");
  await page.getByRole("button", { name: "Create" }).click();

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

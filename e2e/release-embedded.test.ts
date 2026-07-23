import { expect, test } from "@playwright/test";
import { type ReleaseServer, startReleaseServer } from "./release-fixtures.ts";

/**
 * These tests run against the standalone `target/release/silverbullet` binary,
 * which serves the client and plug assets from the rust-embed embedded base
 * filesystem. They therefore validate that the *embedded* bundle boots and
 * that the browser login flow works. A release binary must be built first
 * (`make build-rs`); see the `test-e2e-release` Makefile target.
 */
test.describe("Release binary: embedded bundle", () => {
  let server: ReleaseServer | undefined;

  test.afterEach(async () => {
    await server?.stop();
    server = undefined;
  });

  test("embedded bundle boots and the editor works", async ({ page }) => {
    server = await startReleaseServer();

    await page.goto(`${server.url}/index?headless=1`);
    await page.locator("#sb-editor .cm-editor").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await page.waitForFunction(
      () => (globalThis as any).sbRuntime?.ready === true,
      undefined,
      { timeout: 30_000 },
    );

    // The embedded bundle ships the welcome content on an empty space.
    const editor = page.locator("#sb-editor .cm-content");
    await expect(editor).toBeVisible();
    await expect(editor).toContainText(
      "Welcome to the wondrous world of SilverBullet",
    );

    // Type some text and confirm it persists across a reload.
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Hello from the embedded bundle");
    await expect(editor).toContainText("Hello from the embedded bundle");

    // Wait for the save round-trip to the server, then read it back via the
    // filesystem API to prove the edit was persisted by the release binary.
    const pageNameSel = "#sb-current-page";
    await page.locator(`${pageNameSel}.sb-unsaved`).waitFor({
      state: "attached",
      timeout: 10_000,
    });
    await page.locator(`${pageNameSel}.sb-saved`).waitFor({
      state: "attached",
      timeout: 10_000,
    });

    const resp = await fetch(`${server.url}/.fs/index.md`);
    expect(resp.ok).toBe(true);
    const content = await resp.text();
    expect(content).toContain("Hello from the embedded bundle");
  });

  test("browser login flow", async ({ page }) => {
    server = await startReleaseServer({ SB_USER: "alice:s3cret" });

    // An unauthenticated browser hitting a protected page is redirected to
    // the login page.
    await page.goto(`${server.url}/`);
    await expect(page.locator("#username")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("#password")).toBeVisible();

    // Log in with the configured credentials.
    await page.locator("#username").fill("alice");
    await page.locator("#password").fill("s3cret");
    await page
      .locator("#login")
      .getByRole("button", { name: "Log in" })
      .click();

    // On success the login script redirects into the app; the editor should
    // become visible once the client has booted (first-load indexing of the
    // bundled Library can take a few seconds).
    await page.locator("#sb-editor .cm-editor").waitFor({
      state: "visible",
      timeout: 45_000,
    });

    // Logging out lands us back on the login page.
    await page.goto(`${server.url}/.logout`);
    await expect(page.locator("#username")).toBeVisible({ timeout: 30_000 });
  });
});

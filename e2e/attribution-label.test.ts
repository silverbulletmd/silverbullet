import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import {
  type Browser,
  type BrowserContext,
  type ChildProcess,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { getFreePort, waitForServer } from "./fixtures.ts";

/**
 * External-edit attribution through the full sync topology: two browser
 * contexts with live service workers against one authenticated server. An
 * edit made in one browser must surface in the other with the *account
 * name* on the caret label, not the "external" fallback.
 *
 * Regression: the origin used to ride a single pending slot cleared when
 * the probe's getFileMeta settled; any concurrent metadata fetch (e.g. a
 * plug syscall) would overlap the probe, suppress its file:changed via the
 * operationCount gate, and dispatch its own after the slot was cleared —
 * so a verified username reliably degraded to "external".
 */

let proc: ChildProcess;
let spaceDir: string;
let base: string;

const PAGE_NAME = "AttribPage";
const PAGE_PATH = `${PAGE_NAME}.md`;

async function login(page: Page) {
  await page.goto(`${base}/`);
  await expect(page.locator("#username")).toBeVisible({ timeout: 30_000 });
  await page.locator("#username").fill("alice");
  await page.locator("#password").fill("s3cret");
  await page.getByRole("button", { name: "Log in" }).click();
  await page
    .locator("#sb-editor .cm-editor")
    .waitFor({ state: "visible", timeout: 30_000 });
}

async function openPage(page: Page) {
  await page.goto(`${base}/${PAGE_NAME}`);
  await page
    .locator("#sb-editor .cm-editor")
    .waitFor({ state: "visible", timeout: 30_000 });
  await expect(page.locator("#sb-editor .cm-content")).toContainText("Line1");
}

test.describe
  .serial("external-edit attribution label", () => {
    let ctxA: BrowserContext;
    let ctxB: BrowserContext;
    let pageA: Page;
    let pageB: Page;

    test.beforeAll(async ({ browser }: { browser: Browser }) => {
      spaceDir = await mkdtemp(join(tmpdir(), "sb-attrib-e2e-"));
      await writeFile(
        join(spaceDir, PAGE_PATH),
        "Line1 original\nLine2 original\nLine3 original\n",
      );
      const port = await getFreePort();
      proc = spawn(
        "./target/debug/silverbullet",
        [spaceDir, "-p", String(port), "-L", "127.0.0.1", "--single"],
        {
          cwd: join(import.meta.dirname, ".."),
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            SB_USER: "alice:s3cret",
            SB_RUNTIME_API: "0",
            // Service worker ENABLED: attribution must survive the sync
            // topology, where the SW sync engine (not the probe) pulls the
            // change and concurrent metadata fetches race the probe.
          },
        },
      );
      base = `http://127.0.0.1:${port}`;
      await waitForServer(`${base}/.ping`);

      ctxA = await browser.newContext();
      ctxB = await browser.newContext();
      pageA = await ctxA.newPage();
      pageB = await ctxB.newPage();
      await login(pageA);
      await login(pageB);
      await openPage(pageA);
      await openPage(pageB);
      // Let both sync engines settle before editing.
      await pageA.waitForTimeout(3000);
    });

    test.afterAll(async () => {
      await ctxA?.close();
      await ctxB?.close();
      proc?.kill();
      await rm(spaceDir, { recursive: true, force: true });
    });

    test("caret label names the account that made the edit", async () => {
      const editorB = pageB.locator("#sb-editor .cm-content");
      await editorB.click();
      await pageB.keyboard.press("Control+Home");
      await pageB.keyboard.type("HelloFromB ");
      await pageB
        .locator("#sb-current-page.sb-saved")
        .waitFor({ state: "attached", timeout: 10_000 });

      await expect(pageA.locator("#sb-editor .cm-content")).toContainText(
        "HelloFromB",
        { timeout: 15_000 },
      );

      await expect(pageA.locator(".sb-external-caret-label")).toHaveText(
        "alice",
        { timeout: 5_000 },
      );
    });
  });

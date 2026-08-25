import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  getFreePort,
  waitForServer,
} from "./fixtures";

const BIN = "./target/debug/silverbullet";
const CWD = join(import.meta.dirname, "..");

let proc: ChildProcess;
let rootDir: string;
let base: string;

test.use({ viewport: { width: 375, height: 812 } });

test.beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "sb-spaces-mobile-"));
  execFileSync(
    BIN,
    [
      "setup",
      rootDir,
      "--admin",
      `${ADMIN_USER}:${ADMIN_PASSWORD}`,
      "--space",
      "My Notes",
      "--at",
      "/notes",
    ],
    { cwd: CWD, stdio: "pipe" },
  );

  const port = await getFreePort();
  proc = spawn(BIN, [rootDir, "-p", String(port), "-L", "127.0.0.1"], {
    cwd: CWD,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
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

/**
 * Every element whose box ends past the document's own width, plus every
 * element clipping content it cannot show. Inputs are excluded from the
 * clipping half: a field scrolls its own value by design, at any width.
 */
async function overflowingElements(page: Page): Promise<string[]> {
  return await page.evaluate(() => {
    const docWidth = document.documentElement.clientWidth;
    const found = new Set<string>();
    for (const el of document.querySelectorAll("body *")) {
      const name = `${el.tagName.toLowerCase()}.${
        String(el.className || "").trim() || "(no class)"
      }`;
      if (el.getBoundingClientRect().right > docWidth + 1) {
        found.add(`${name} extends past the viewport`);
      }
      if (
        !(el instanceof HTMLInputElement) &&
        el.clientWidth > 0 &&
        el.scrollWidth > el.clientWidth + 1
      ) {
        found.add(`${name} clips its content`);
      }
    }
    return [...found];
  });
}

async function expectFits(page: Page): Promise<void> {
  expect(await overflowingElements(page)).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(375);
}

test("the Space Manager fits a phone viewport on every screen", async ({
  page,
}) => {
  await page.goto(`${base}/.spaces/login`);
  await page.getByLabel("Username").fill(ADMIN_USER);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page.getByRole("link", { name: "My Notes" })).toBeVisible();
  await expectFits(page);

  for (const path of ["/new", "/users", `/users/${ADMIN_USER}`, "/profile"]) {
    await page.goto(`${base}/.spaces${path}`);
    // Each screen fetches before it renders its controls; the log-out button
    // is in the shell, so wait on something the screen itself owns.
    await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectFits(page);
  }
});

test("the tab bar reads as one row and the log-out link as one line", async ({
  page,
}) => {
  await page.goto(`${base}/.spaces/login`);
  await page.getByLabel("Username").fill(ADMIN_USER);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();

  // The header used to overflow its card, which stacked the three tabs on top
  // of one another and broke "Log out" across two lines.
  const header = await page.evaluate(() => {
    // A Range's client rects follow the text's own line boxes, so this counts
    // rendered lines whatever the element's display happens to be. Distinct
    // tops rather than rect count: a label built from several text nodes (the
    // Profile tab is `{username}'s Profile`) gets a rect each on one line.
    const linesOf = (el: Element) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const tops = [...range.getClientRects()].map((r) => Math.round(r.top));
      return new Set(tops).size;
    };
    const tabs = [...document.querySelectorAll(".sb-tab")];
    return {
      logoutLines: linesOf(document.querySelector(".sb-logout")!),
      tabLines: tabs.map(linesOf),
      tabTops: [
        ...new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))),
      ],
    };
  });

  expect(header.logoutLines).toBe(1);
  expect(header.tabLines).toEqual([1, 1, 1]);
  // One distinct top edge: all three tabs sit on the same row.
  expect(header.tabTops).toHaveLength(1);
});

test("form fields are big enough to tap and never trigger iOS zoom", async ({
  page,
}) => {
  await page.goto(`${base}/.spaces/users/${ADMIN_USER}`);
  await page.getByLabel("Username").fill(ADMIN_USER);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("button", { name: "Save" })).toBeVisible();

  const controls = await page.evaluate(() =>
    [
      ...document.querySelectorAll<HTMLElement>(
        ".sb-input, .sb-select, .sb-button, .sb-button-primary, .sb-button-danger",
      ),
    ].map((el) => ({
      label: `${el.tagName.toLowerCase()}.${el.className}`,
      height: el.getBoundingClientRect().height,
      // iOS Safari zooms the page in on focus for anything under 16px and
      // never zooms back out.
      fontSize: parseFloat(getComputedStyle(el).fontSize),
    })),
  );

  expect(controls.length).toBeGreaterThan(0);
  expect(controls.filter((c) => c.height < 44)).toEqual([]);
  expect(controls.filter((c) => c.fontSize < 16)).toEqual([]);
});

test("the setup wizard fits a phone viewport", async ({ page }) => {
  // A second, unprovisioned server: the wizard only exists before setup runs.
  const port = await getFreePort();
  const dir = await mkdtemp(join(tmpdir(), "sb-wizard-mobile-"));
  const wizardProc = spawn(BIN, [dir, "-p", String(port), "-L", "127.0.0.1"], {
    cwd: CWD,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      SB_RUNTIME_API: "0",
      SB_DISABLE_SERVICE_WORKER: "1",
    },
  });
  const wizardBase = `http://127.0.0.1:${port}`;

  try {
    await waitForServer(`${wizardBase}/.setup/`);
    await page.goto(`${wizardBase}/.setup/`);

    await expect(
      page.getByRole("heading", { name: "Welcome to SilverBullet" }),
    ).toBeVisible();
    await expectFits(page);

    await page.locator("#setup-username").fill(ADMIN_USER);
    await page.locator("#setup-password").fill(ADMIN_PASSWORD);
    await page.locator("#setup-password2").fill(ADMIN_PASSWORD);
    await page.getByRole("button", { name: "Continue" }).click();

    await expect(
      page.getByRole("heading", { name: "Create your first space" }),
    ).toBeVisible();
    await expectFits(page);

    // The folder browser lists real directory names, which have no length
    // limit and are each one unbreakable word.
    await page.getByRole("button", { name: "Browse…" }).click();
    await expect(page.locator(".sb-folder-browser")).toBeVisible();
    await page.waitForLoadState("networkidle");
    await expectFits(page);
  } finally {
    wizardProc.kill();
    await rm(dir, { recursive: true, force: true });
  }
});

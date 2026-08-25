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

let proc: ChildProcess;
let rootDir: string;
let base: string;

const BIN = "./target/debug/silverbullet";
const CWD = join(import.meta.dirname, "..");

test.beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "sb-users-oidc-e2e-"));
  execFileSync(
    BIN,
    ["setup", rootDir, "--admin", `${ADMIN_USER}:${ADMIN_PASSWORD}`],
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

/** Call an admin API endpoint using the page's session cookie jar. */
async function admin(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const resp = await page.request.fetch(`${base}/.spaces/${path}`, {
    method,
    data: body,
  });
  expect(resp.ok(), `${method} ${path} → ${resp.status()}`).toBeTruthy();
  return resp.json();
}

test.beforeEach(async ({ page }) => {
  await page.goto(`${base}/.spaces`);
  await page.getByLabel("Username").fill(ADMIN_USER);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".sb-tab.sb-active")).toHaveText("Spaces");
});

// Seeded once for the whole file (single worker, tests run in order):
// one OIDC-linked user, one unlinked, each with an admin display name.
test("setup: seed users with display names and OIDC link", async ({
  page,
}) => {
  await admin(page, "POST", "api/admin/users", {
    username: "test-user-one",
    password: "pw123456",
    admin: false,
  });
  await admin(page, "POST", "api/admin/users", {
    username: "test-user-two",
    password: "pw123456",
    admin: false,
  });
  await admin(page, "POST", "api/admin/users/test-user-one/oidc-link", {
    issuer: "https://auth.example.com/test",
    subject: "sub-aaa1234567890abcdef",
  });
  await admin(page, "POST", "api/admin/users/test-user-one/full-name", {
    fullName: "Test User One",
  });
  await admin(page, "POST", "api/admin/users/test-user-two/full-name", {
    fullName: "Test User Two",
  });
});

test("list shows display names under account names", async ({ page }) => {
  await page.goto(`${base}/.spaces/users`, { waitUntil: "domcontentloaded" });
  // Auto-retries until the list fetch resolves and renders.
  await expect(page.getByText("Test User One")).toBeVisible();
  await expect(page.getByText("Test User Two")).toBeVisible();
});

test("unlinked user detail: Advanced block with display-name editor", async ({
  page,
}) => {
  await page.goto(`${base}/.spaces/users/test-user-two`);

  const details = page.locator("details");
  await expect(details).toBeAttached();
  // Collapsed by default.
  expect(await details.getAttribute("open")).toBeNull();

  await details.locator("summary").click();
  await expect(details).toContainText("Display name");
  await expect(details).toContainText("Single sign-on");

  await expect(details.locator("#oidc-link-issuer")).toBeAttached();
  await expect(details.locator("#oidc-link-subject")).toBeAttached();
  await expect(
    details.getByRole("button", { name: "Link", exact: true }),
  ).toBeDisabled();

  await page
    .locator('input[aria-label="Display name"]')
    .fill("Custom Override");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.locator("body")).toContainText("Custom override");
  await expect(page.locator("body")).toContainText("Reset to automatic");

  await page.getByRole("button", { name: "Reset to automatic" }).click();
  await expect(page.locator("body")).toContainText("Follows the SSO provider");
});

test("linked user detail: Unlink / Relink round-trip", async ({ page }) => {
  await page.goto(`${base}/.spaces/users/test-user-one`);

  const details = page.locator("details");
  await details.locator("summary").click();
  await expect(details).toContainText("Unlink");

  const readonlyVals = await details
    .locator("input[readonly]")
    .evaluateAll((els) => els.map((e) => e.value));
  expect(
    readonlyVals.some((v) => v === "https://auth.example.com/test"),
  ).toBeTruthy();
  expect(readonlyVals.some((v) => v.startsWith("sub-aaa123"))).toBeTruthy();

  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Unlink" }).click();
  await expect(details).toContainText("Link this account");
  await expect(details).not.toContainText("Unlink");

  await page.fill("#oidc-link-issuer", "https://auth.example.com/test");
  await page.fill("#oidc-link-subject", "sub-aaa1234567890abcdef");
  await page.getByRole("button", { name: "Link", exact: true }).click();
  await expect(details).toContainText("Unlink");
});

import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  getFreePort,
  waitForEditorReady,
  waitForServer,
} from "./fixtures";
import { runCommandViaPalette } from "./navigator-ui.ts";

let proc: ChildProcess;
let rootDir: string;
let base: string;

const BIN = "./target/debug/silverbullet";
const CWD = join(import.meta.dirname, "..");

test.beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "sb-profile-e2e-"));

  // Same non-interactive provisioning as admin-spaces.test.ts: `setup`
  // writes users.json (the admin account) + an empty spaces.json, which is
  // what boots the server into account-managed mode.
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

test.beforeEach(async ({ page }) => {
  await login(page, ADMIN_USER, ADMIN_PASSWORD);
  await expect(page.locator(".sb-tab.sb-active")).toHaveText("Spaces");
});

async function login(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto(`${base}/.spaces/login`);
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  // Login redirects client-side; without waiting for it to land, a
  // follow-up page.goto races the in-flight navigation and gets aborted.
  // "Log out" is present on the post-login shell for both admins and
  // members, unlike the "Spaces" tab/heading (admin vs. member differ).
  await page.getByRole("button", { name: "Log out" }).waitFor();
}

/** Call an admin API endpoint using the given page's session cookie. */
async function adminApi(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const resp = await page.request.fetch(`${base}/.spaces/${path}`, {
    method,
    data: body,
  });
  expect(resp.ok(), await resp.text()).toBeTruthy();
  return resp.json();
}

test("a commit is attributed to the acting account's profile", async ({
  page,
}) => {
  const spaceDir = join(rootDir, "attribution-space");
  await adminApi(page, "POST", "api/admin/users", {
    username: "ada",
    password: "adapass123",
    fullName: "Ada Lovelace",
    email: "ada@example.org",
  });
  await adminApi(page, "POST", "api/admin/spaces", {
    name: "Attribution",
    binding: { prefix: "/attribution" },
    members: { ada: {} },
    revisions: "managed",
    folder: spaceDir,
  });

  await page.context().clearCookies();
  await login(page, "ada", "adapass123");

  await page.goto(`${base}/attribution/?headless=1`);
  await page
    .locator("#sb-editor .cm-editor")
    .waitFor({ state: "visible", timeout: 30_000 });
  await waitForEditorReady(page);

  await page.locator("#sb-editor .cm-content").click();
  await page.keyboard.type("Edited by ada");
  await page
    .locator("#sb-current-page.sb-saved")
    .waitFor({ state: "attached", timeout: 10_000 });

  await runCommandViaPalette(page, "Revision: Create snapshot");

  // Same direct git-log read revisions.test.ts's own "Create snapshot" test
  // uses, extended to `%ae` since it's the author *and* email under test.
  await expect(async () => {
    const log = execFileSync("git", ["log", "-1", "--format=%an <%ae>"], {
      cwd: spaceDir,
      // Explicit pipe: execFileSync otherwise leaks a failing git
      // invocation's stderr straight to the test runner's own output (e.g.
      // "fatal: ... does not have any commits yet" on the empty repo the
      // first few retries see), even though the failure is caught here.
      stdio: ["ignore", "pipe", "pipe"],
    })
      .toString()
      .trim();
    expect(log).toBe("Ada Lovelace <ada@example.org>");
  }).toPass({ timeout: 10_000 });
});

test("the Mention Inbox opens on the current user", async ({ page }) => {
  const spaceDir = join(rootDir, "mentions-space");
  await adminApi(page, "POST", "api/admin/users", {
    username: "mona",
    password: "monapass123",
  });
  await adminApi(page, "POST", "api/admin/spaces", {
    name: "Mentions",
    binding: { prefix: "/mentions" },
    members: { mona: {} },
    folder: spaceDir,
  });

  const write = async (path: string, content: string) => {
    const fullPath = join(spaceDir, path);
    await mkdir(dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content);
  };
  // Page-backed recipient whose derived nickname ("Mona") matches the
  // signed-in username case-insensitively, exactly like e2e/at-mention.test.ts's
  // "Pete Smith" fixture.
  await write(
    "People/Mona.md",
    ["---", "tags: recipient", "---", "", "Mona's page.", ""].join("\n"),
  );
  await write(
    "Notes.md",
    ["Hello @Mona, welcome!", "", "Ping @Someone for approval.", ""].join("\n"),
  );

  await page.context().clearCookies();
  await login(page, "mona", "monapass123");

  await page.goto(`${base}/mentions/Notes?headless=1`);
  await page
    .locator("#sb-editor .cm-editor")
    .waitFor({ state: "visible", timeout: 30_000 });
  await waitForEditorReady(page);

  await runCommandViaPalette(page, "Navigate: Mentions");

  const inbox = page.locator(".sb-nav-root-rhs");
  await expect(inbox.locator(".sb-nav-title")).toHaveText("Mention Inbox");
  const dropdown = inbox.locator("select.sb-nav-dropdown");
  await expect(dropdown.locator("option:checked")).toHaveText("Mona", {
    timeout: 20_000,
  });

  await expect(
    inbox.locator(".sb-nav-row", { hasText: "Hello @Mona, welcome!" }),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    inbox.locator(".sb-nav-row", { hasText: "Ping @Someone for approval." }),
  ).toHaveCount(0);
});

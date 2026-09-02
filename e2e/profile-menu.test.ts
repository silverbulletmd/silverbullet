import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  getFreePort,
  gotoSilverBulletPage,
  test as singleSpaceTest,
  waitForEditorReady,
  waitForServer,
} from "./fixtures.ts";

let proc: ChildProcess;
let rootDir: string;
let base: string;

const BIN = "./target/debug/silverbullet";
const CWD = join(import.meta.dirname, "..");

test.beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "sb-profile-menu-e2e-"));

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
  await page.goto(`${base}/.spaces`);
  await page.getByLabel("Username").fill(ADMIN_USER);
  await page.getByLabel("Password", { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.locator(".sb-tab.sb-active")).toHaveText("Spaces");
});

/** Call an admin API endpoint using the given page's (admin) session cookie. */
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

type SpaceOptions = {
  name: string;
  prefix: string;
  members?: Record<string, unknown>;
  access?: "read" | "write" | "none";
};

/** Create a space via the admin API, in its own folder under `rootDir`. */
async function createSpace(
  page: Page,
  opts: SpaceOptions,
): Promise<{ id: string; folder: string }> {
  const folder = join(rootDir, opts.prefix.replace(/^\//, ""));
  const body: Record<string, unknown> = {
    name: opts.name,
    binding: { prefix: opts.prefix },
    folder,
  };
  if (opts.members) body.members = opts.members;
  if (opts.access) body.access = opts.access;
  const json = await adminApi(page, "POST", "api/admin/spaces", body);
  return { id: json.id, folder };
}

async function writeSpaceFile(
  folder: string,
  path: string,
  content: string,
): Promise<void> {
  const fullPath = join(folder, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

async function apiLogin(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  const resp = await page.request.post(`${base}/.spaces/api/login`, {
    data: { username, password },
  });
  expect(resp.ok(), await resp.text()).toBeTruthy();
}

async function gotoSpacePage(
  page: Page,
  prefix: string,
  pageName: string,
): Promise<void> {
  await page.goto(
    `${base}${prefix}/${encodeURIComponent(pageName)}?headless=1`,
  );
  await page
    .locator("#sb-editor .cm-editor")
    .waitFor({ state: "visible", timeout: 30_000 });
  await waitForEditorReady(page);
}

const profileTrigger = (page: Page) =>
  page.locator("#sb-top button:has(.sb-profile-avatar)");

async function gotoAsAda(page: Page, prefix: string): Promise<string> {
  const username = prefix.replaceAll("/", "").replaceAll("-", "");
  await adminApi(page, "POST", "api/admin/users", {
    username,
    password: "adapass123",
    fullName: "Ada Lovelace",
  });
  const { folder } = await createSpace(page, {
    name: "Ada Space",
    prefix,
    members: { [username]: {} },
  });
  await writeSpaceFile(folder, "Welcome.md", "Hello Ada\n");

  await page.context().clearCookies();
  await apiLogin(page, username, "adapass123");
  await gotoSpacePage(page, prefix, "Welcome");
  return username;
}

function storedRecordCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const open = (name: string) =>
      new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
    let total = 0;
    for (const info of await indexedDB.databases()) {
      if (!info.name) continue;
      const db = await open(info.name);
      for (const store of Array.from(db.objectStoreNames)) {
        total += await new Promise<number>((resolve, reject) => {
          const request = db
            .transaction(store, "readonly")
            .objectStore(store)
            .count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
      }
      db.close();
    }
    return total;
  });
}

test("the profile button names the signed-in account", async ({ page }) => {
  const username = await gotoAsAda(page, "/ada-name");

  const trigger = profileTrigger(page);
  await expect(trigger).toBeVisible();
  await expect(trigger.locator(".sb-profile-avatar-signed-in")).toHaveText(
    "AL",
  );
  await expect(trigger).toHaveAttribute("aria-haspopup", "menu");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  const menu = page.locator(".sb-anchored-menu");
  await expect(menu.locator(".sb-anchored-menu-title")).toHaveText(
    "Ada Lovelace",
  );
  await expect(menu.locator(".sb-anchored-menu-subtitle")).toHaveText(username);
});

test("the menu can be opened and dismissed repeatedly on one page load", async ({
  page,
}) => {
  await gotoAsAda(page, "/ada-repeat");

  const trigger = profileTrigger(page);
  const menu = page.locator(".sb-anchored-menu");

  for (let i = 0; i < 2; i++) {
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await page.mouse.click(5, 5);
    await expect(menu).toHaveCount(0);
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
  }
});

test("an outside click closes the dropdown and leaves focus where the click put it", async ({
  page,
}) => {
  await gotoAsAda(page, "/ada-outside-click");

  const trigger = profileTrigger(page);
  const menu = page.locator(".sb-anchored-menu");
  await trigger.click();
  await expect(menu).toBeVisible();

  // Anywhere off the menu and its trigger — the top-left corner.
  await page.mouse.click(5, 5);
  await expect(menu).toHaveCount(0);
  // The menu manages no focus of its own: it stays wherever the click put it.
  await expect(trigger).not.toBeFocused();
});

test("Edit profile and All spaces are reachable, and selecting an item closes the menu", async ({
  page,
}) => {
  await adminApi(page, "POST", "api/admin/users", {
    username: "bo",
    password: "bopass123",
  });
  const { folder } = await createSpace(page, {
    name: "Bo Space",
    prefix: "/bo",
    members: { bo: {} },
  });
  await writeSpaceFile(folder, "Welcome.md", "Hello Bo\n");

  await page.context().clearCookies();
  await apiLogin(page, "bo", "bopass123");
  await gotoSpacePage(page, "/bo", "Welcome");

  // Edit profile opens a new tab, so the space stays put behind it.
  await profileTrigger(page).click();
  const [profileTab] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "Edit profile" }).click(),
  ]);
  await expect(profileTab).toHaveURL(`${base}/.spaces/profile`);
  await expect(profileTab.locator(".sb-tab.sb-active")).toHaveText(
    "bo's Profile",
  );
  await expect(page).toHaveURL(`${base}/bo/Welcome`);
  await profileTab.close();

  await gotoSpacePage(page, "/bo", "Welcome");
  await profileTrigger(page).click();
  await expect(page.locator(".sb-anchored-menu")).toBeVisible();
  await page.getByRole("button", { name: "All spaces" }).click();
  await expect(page).toHaveURL(/\/\.spaces\/?$/);
  await expect(page.getByRole("heading", { name: "Spaces" })).toBeVisible();
  await expect(page.locator(".sb-anchored-menu")).toHaveCount(0);
});

test("Log out ends the session -- the next request is unauthenticated, not just the URL", async ({
  page,
}) => {
  await adminApi(page, "POST", "api/admin/users", {
    username: "cy",
    password: "cypass123",
  });
  const { folder } = await createSpace(page, {
    name: "Cy Space",
    prefix: "/cy",
    members: { cy: {} },
  });
  await writeSpaceFile(folder, "Welcome.md", "Hello Cy\n");

  await page.context().clearCookies();
  await apiLogin(page, "cy", "cypass123");
  await gotoSpacePage(page, "/cy", "Welcome");

  await expect.poll(() => storedRecordCount(page)).toBeGreaterThan(0);

  await profileTrigger(page).click();
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(`${base}/cy/.auth`);

  const resp = await page.request.get(`${base}/.spaces/api/profile`);
  expect(resp.status()).toBe(401);

  await expect.poll(() => storedRecordCount(page)).toBe(0);
});

test("reordering the profile button by priority moves it", async ({ page }) => {
  await adminApi(page, "POST", "api/admin/users", {
    username: "pr",
    password: "prpass123",
  });
  const { folder } = await createSpace(page, {
    name: "Priority Space",
    prefix: "/priority",
    members: { pr: {} },
  });
  await writeSpaceFile(
    folder,
    "Config.md",
    [
      "```space-lua",
      'config.set("actionButtons", {',
      "  {",
      '    icon = "book",',
      '    description = "Open page",',
      '    command = "Navigate: Page Picker",',
      "    priority = 1,",
      "  },",
      "  {",
      '    icon = "profile",',
      '    description = "Account",',
      "    accountManaged = true,",
      "    priority = 100,",
      "  },",
      "})",
      "```",
      "",
    ].join("\n"),
  );
  await writeSpaceFile(folder, "Welcome.md", "Hello\n");

  await page.context().clearCookies();
  await apiLogin(page, "pr", "prpass123");
  await gotoSpacePage(page, "/priority", "Welcome");

  await expect(profileTrigger(page)).toBeVisible();
  const firstButton = page.locator("#sb-top .sb-actions button").first();
  await expect(firstButton.locator(".sb-profile-avatar")).toHaveCount(1);
});

test("removing the profile entry from actionButtons removes the button", async ({
  page,
}) => {
  await adminApi(page, "POST", "api/admin/users", {
    username: "rm",
    password: "rmpass123",
  });
  const { folder } = await createSpace(page, {
    name: "No Profile Space",
    prefix: "/noprofile",
    members: { rm: {} },
  });
  await writeSpaceFile(
    folder,
    "Config.md",
    [
      "```space-lua",
      'config.set("actionButtons", {',
      "  {",
      '    icon = "book",',
      '    description = "Open page",',
      '    command = "Navigate: Page Picker",',
      "    priority = 1,",
      "  },",
      "})",
      "```",
      "",
    ].join("\n"),
  );
  await writeSpaceFile(folder, "Welcome.md", "Hello\n");

  await page.context().clearCookies();
  await apiLogin(page, "rm", "rmpass123");
  await gotoSpacePage(page, "/noprofile", "Welcome");

  // The rest of the config is honoured, so a wholesale render failure isn't
  // masking a passing assertion below.
  // The title carries an appended keyboard-shortcut hint, so match a prefix.
  await expect(page.getByTitle(/^Open page/)).toBeVisible();
  await expect(profileTrigger(page)).toHaveCount(0);
});

test("signed out on a published space, Log in returns to the originating page", async ({
  page,
}) => {
  const { folder } = await createSpace(page, {
    name: "Public Space",
    prefix: "/public",
    access: "read",
  });
  await writeSpaceFile(folder, "Welcome.md", "Hello, everyone\n");
  await adminApi(page, "POST", "api/admin/users", {
    username: "reader",
    password: "readerpass123",
  });

  await page.context().clearCookies();
  await gotoSpacePage(page, "/public", "Welcome");

  const trigger = profileTrigger(page);
  await expect(trigger.locator(".sb-profile-avatar-signed-out")).toBeVisible();

  await trigger.click();
  const menu = page.locator(".sb-anchored-menu");
  await expect(menu.locator("button")).toHaveText(["Log in"]);
  await page.getByRole("button", { name: "Log in" }).click();

  await expect(page).toHaveURL(/\/public\/\.auth\?from=/);
  await page.getByLabel("Username").fill("reader");
  await page.getByLabel("Password", { exact: true }).fill("readerpass123");
  await page.getByRole("button", { name: "Log in" }).click();

  // Back on the page it started from -- not the space's own index, and not
  // `/.spaces`.
  await expect(page).toHaveURL(`${base}/public/Welcome`);
});

test.describe("mobile", () => {
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: async ({ browserName }, use) =>
      await use(browserName !== "firefox"),
    isMobile: async ({ browserName }, use) =>
      await use(browserName !== "firefox"),
  });

  test.skip(
    ({ browserName }) => browserName === "firefox",
    "Firefox cannot emulate touch, so isMobileDevice() stays false",
  );

  test("on a mobile viewport the profile button opens the filter box, not the dropdown", async ({
    page,
  }) => {
    await adminApi(page, "POST", "api/admin/users", {
      username: "mo",
      password: "mopass123",
      fullName: "Mo Bile",
    });
    const { folder } = await createSpace(page, {
      name: "Mobile Space",
      prefix: "/mobilespace",
      members: { mo: {} },
    });
    await writeSpaceFile(folder, "Welcome.md", "Hello mobile\n");

    await page.context().clearCookies();
    await apiLogin(page, "mo", "mopass123");
    await gotoSpacePage(page, "/mobilespace", "Welcome");

    // The profile button ships with the default `dropdown` (true), so below
    // the breakpoint it sits behind the hamburger like any other button.
    await page.getByTitle("Open Menu").click();
    const hamburger = page.locator("#sb-top .sb-actions.hamburger");
    await expect(hamburger).toHaveClass(/open/);

    // The reveal past the hamburger's collapsed height is CSS `:hover`
    // (real devices get it for free from the tap that opens the menu); force
    // the click through it rather than assert on that animation, since the
    // behaviour under test is which UI the button opens, not the hover CSS.
    await profileTrigger(page).click({ force: true });

    const filterBox = page.locator(".sb-modal-box");
    await expect(filterBox.locator(".sb-header label")).toHaveText(
      "Mo Bile (mo)",
    );
    await expect(page.locator(".sb-anchored-menu")).toHaveCount(0);

    await filterBox.locator("input").fill("All spaces");
    await expect(filterBox.locator(".sb-option")).toHaveCount(1);
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/\.spaces\/?$/);
  });

  test("Edit profile still opens a tab from the filter box", async ({
    page,
  }) => {
    await adminApi(page, "POST", "api/admin/users", {
      username: "mt",
      password: "mtpass123",
      fullName: "Mo Tab",
    });
    const { folder } = await createSpace(page, {
      name: "Mobile Tab Space",
      prefix: "/mobiletab",
      members: { mt: {} },
    });
    await writeSpaceFile(folder, "Welcome.md", "Hello tab\n");

    await page.context().clearCookies();
    await apiLogin(page, "mt", "mtpass123");
    await gotoSpacePage(page, "/mobiletab", "Welcome");

    await page.getByTitle("Open Menu").click();
    await profileTrigger(page).click({ force: true });
    const filterBox = page.locator(".sb-modal-box");
    await filterBox.locator("input").fill("Edit profile");
    await expect(filterBox.locator(".sb-option")).toHaveCount(1);

    const [profileTab] = await Promise.all([
      page.waitForEvent("popup"),
      page.keyboard.press("Enter"),
    ]);
    await expect(profileTab).toHaveURL(`${base}/.spaces/profile`);
    await expect(page).toHaveURL(`${base}/mobiletab/Welcome`);
    await profileTab.close();
  });
});

singleSpaceTest.describe("single-space server", () => {
  singleSpaceTest(
    "the profile button is absent, and the client never asks the profile API",
    async ({ page, sbServer }) => {
      // Asserted on the network, not the console: a single-space server has no
      // /.spaces route, so the request falls through to the client-bundle
      // fallback and returns 200 with the HTML shell -- no console error. A
      // console assertion here would pass even with the request being made.
      const asked: string[] = [];
      page.on("request", (request) => {
        if (request.url().includes("/.spaces/api/profile")) {
          asked.push(request.url());
        }
      });

      await gotoSilverBulletPage(page, sbServer);

      await expect(page.locator(".sb-profile-avatar")).toHaveCount(0);
      expect(asked).toEqual([]);
    },
  );
});

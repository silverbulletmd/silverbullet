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

/**
 * A space bound at "/" registers its service worker at scope "/", which covers
 * every path on the origin — including the prefixes of *other* spaces. These
 * tests pin down that such a worker must not answer navigations belonging to a
 * different space with its own cached app shell: that shell carries the root
 * space's `<base href="/">`, so the client would boot resolving `.config` and
 * `/.fs/*` against the server root and silently load the wrong space.
 *
 * Unlike the rest of the multi-space e2e suite, these run with the service
 * worker ENABLED — the bug is unreachable without it.
 */

const BIN = "./target/debug/silverbullet";
const CWD = join(import.meta.dirname, "..");

let proc: ChildProcess;
let rootDir: string;
let base: string;
let cookie: string;

/** Call the admin API (nested at `/.spaces/api/admin`) as the logged-in admin. */
async function admin(method: string, path: string, body?: unknown) {
  const resp = await fetch(`${base}/.spaces/api/admin/${path}`, {
    method,
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`${method} ${path} -> ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

/** Create a public space so the browser side needs no login. */
async function createSpace(name: string, prefix: string): Promise<string> {
  const { id } = await admin("POST", "spaces", {
    name,
    folder: join(rootDir, `${name}-space`),
    binding: { prefix },
    public: true,
    seedIndex: true,
  });
  return id;
}

/**
 * Load the root space and wait until its service worker controls the page —
 * that worker is what the assertions below guard. Each test gets a fresh
 * browser context, so this re-registers per test.
 */
async function registerRootServiceWorker(page: Page) {
  await page.goto(`${base}/`);
  await page.waitForFunction(
    () => !!navigator.serviceWorker.controller,
    undefined,
    {
      timeout: 30_000,
    },
  );
  // Let the worker finish precaching the app shell before we navigate away.
  await page.waitForTimeout(2000);
}

test.beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), "sb-sw-scope-e2e-"));
  execFileSync(
    BIN,
    ["setup", rootDir, "--admin", `${ADMIN_USER}:${ADMIN_PASSWORD}`],
    {
      cwd: CWD,
      stdio: "pipe",
    },
  );

  const port = await getFreePort();
  proc = spawn(BIN, [rootDir, "-p", String(port), "-L", "127.0.0.1"], {
    cwd: CWD,
    stdio: ["ignore", "pipe", "pipe"],
    // Note: SB_DISABLE_SERVICE_WORKER is deliberately NOT set here.
    env: { ...process.env, SB_RUNTIME_API: "0" },
  });
  base = `http://127.0.0.1:${port}`;
  await waitForServer(`${base}/.spaces`);

  const login = await fetch(`${base}/.spaces/api/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
  });
  cookie = login.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

  // The root-bound space whose service worker shadows the whole origin. Both
  // tests depend on it, and only one space can hold "/" — so it is created
  // once here rather than per test.
  await createSpace("root", "/");
});

test.afterAll(async () => {
  proc?.kill();
  await rm(rootDir, { recursive: true, force: true });
});

test("a sibling space is not shadowed by the root space's service worker", async ({
  page,
}) => {
  await registerRootServiceWorker(page);
  await createSpace("sibling", "/sibling");

  await page.goto(`${base}/sibling/`);

  // The decisive assertion: the client must boot against the sibling space's
  // base URL. When the root worker serves its own cached shell instead, this
  // is `${base}/` and the client silently loads the root space.
  expect(await page.evaluate(() => document.baseURI)).toBe(`${base}/sibling/`);
});

test("a space moved to a different prefix still boots", async ({ page }) => {
  const id = await createSpace("moved", "/before");
  await registerRootServiceWorker(page);

  await admin("PATCH", `spaces/${id}`, { binding: { prefix: "/after" } });

  await page.goto(`${base}/after/`);

  expect(await page.evaluate(() => document.baseURI)).toBe(`${base}/after/`);
});

test("a sibling space's client assets are not answered with the app shell", async ({
  page,
}) => {
  // The root worker's scope covers `/private/.client/*`, but those files are
  // not in its precache (whose keys are its own space's) and not in its local
  // data — so it used to fall through to the SPA-shell fallback and answer a
  // JavaScript module request with HTML. The browser refuses to execute that,
  // and the login page it belongs to renders blank.
  //
  // A private space, because its login page is the one asset request a visitor
  // makes before authenticating anywhere — the case a user actually hits.
  await registerRootServiceWorker(page);
  await admin("POST", "spaces", {
    name: "private",
    folder: join(rootDir, "private-space"),
    binding: { prefix: "/private" },
    public: false,
    seedIndex: true,
  });

  const asset = await page.evaluate(async (url) => {
    const response = await fetch(url);
    return {
      status: response.status,
      body: (await response.text()).slice(0, 40),
    };
  }, `${base}/private/.client/auth.js`);

  expect(asset.status).toBe(200);
  expect(asset.body).not.toContain("<!doctype");

  // And the page that needs it actually renders its form.
  await page.goto(`${base}/private/`);
  await expect(page.locator("#login")).toBeVisible({ timeout: 30_000 });
  await expect(page.locator("#username")).toBeVisible();
});

import { type ChildProcess, spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type Browser, expect, type Page, test } from "@playwright/test";
import { getFreePort, waitForEditorReady, waitForServer } from "./fixtures";

/**
 * The client-encryption flow, end to end.
 *
 * The key never touches disk: the login page derives it from the credentials
 * just typed and hands it to the service worker, which holds it in memory
 * only; the editor asks the worker for it on boot (see
 * `client/spaces_ui/encryption.ts`, `client/boot.ts`'s `findEncryptionKey`
 * and `client/service_worker.ts`'s `encryptionKeyMemoryStore`).
 *
 * So, unlike most of the e2e suite, these run with the service worker ENABLED
 * — with `SB_DISABLE_SERVICE_WORKER=1` there is nowhere to put the key and the
 * feature does not exist.
 *
 * What is actually protected is the client's local datastore (IndexedDB):
 * `EncryptedKvPrimitives` wraps it, and unencrypted its keys spell out your
 * page names in the clear (`aug\0pageMeta\0MyPrivatePage`). Page *bodies* are
 * not asserted on here because online they are not cached locally at all —
 * they are fetched through the service worker per request.
 */

const BIN = "./target/debug/silverbullet";
const CWD = join(import.meta.dirname, "..");
const USER = "alice";
const PASSWORD = "s3cret";

let proc: ChildProcess;
let spaceDir: string;
let base: string;

test.beforeAll(async () => {
  spaceDir = await mkdtemp(join(tmpdir(), "sb-encryption-e2e-"));

  const port = await getFreePort();
  proc = spawn(BIN, [spaceDir, "-p", String(port), "-L", "127.0.0.1"], {
    cwd: CWD,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // A login is what makes client encryption available at all:
      // `enable_client_encryption` tracks whether the space has an authorizer.
      SB_USER: `${USER}:${PASSWORD}`,
      SB_RUNTIME_API: "0",
      // SB_DISABLE_SERVICE_WORKER is deliberately NOT set — see above.
    },
  });
  base = `http://127.0.0.1:${port}`;
  await waitForServer(`${base}/.auth`);
});

test.afterAll(async () => {
  proc?.kill();
  await rm(spaceDir, { recursive: true, force: true });
});

/** Log in on the space's own login page, optionally opting into encryption. */
async function login(page: Page, { encrypt }: { encrypt: boolean }) {
  await page.goto(`${base}/`);
  await expect(page.locator("#username")).toBeVisible({ timeout: 30_000 });
  await page.locator("#username").fill(USER);
  await page.locator("#password").fill(PASSWORD);
  if (encrypt) await page.locator("#clientEncryption").check();
  await page.getByRole("button", { name: "Log in" }).click();
  await page
    .locator("#sb-editor .cm-editor")
    .waitFor({ state: "visible", timeout: 30_000 });
}

/**
 * Open a page of our own and type `text` into it. Deliberately not the index:
 * that one is the seeded welcome page, thick with widgets that swallow a click
 * meant for the text.
 */
async function writeMarker(page: Page, pageName: string, text: string) {
  await page.goto(`${base}/${pageName}?headless=1`);
  await page
    .locator("#sb-editor .cm-editor")
    .waitFor({ state: "visible", timeout: 30_000 });
  await waitForEditorReady(page);

  const editor = page.locator("#sb-editor .cm-content");
  await editor.click();
  await page.keyboard.type(text);
  await expect(editor).toContainText(text);

  // The datastore write we are about to inspect happens on save, not on
  // keystroke: wait for the unsaved -> saved round trip.
  const pageNameSel = "#sb-current-page";
  await page
    .locator(`${pageNameSel}.sb-unsaved`)
    .waitFor({ state: "attached", timeout: 10_000 });
  await page
    .locator(`${pageNameSel}.sb-saved`)
    .waitFor({ state: "attached", timeout: 10_000 });
}

/**
 * Every key and value in every IndexedDB database this origin has, as one
 * string. Deliberately schema-agnostic: the question is "does this name appear
 * anywhere at all", not "is this particular record encrypted". Keys matter as
 * much as values — the datastore keys are where page names show up.
 */
async function dumpIndexedDb(page: Page): Promise<string> {
  return await page.evaluate(async () => {
    const names = (await indexedDB.databases())
      .map((database) => database.name)
      .filter((name): name is string => !!name);
    const chunks: string[] = [];
    for (const name of names) {
      chunks.push(name);
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      for (const store of Array.from(db.objectStoreNames)) {
        const values = await new Promise<unknown[]>((resolve, reject) => {
          const request = db
            .transaction(store, "readonly")
            .objectStore(store)
            .getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        const keys = await new Promise<unknown[]>((resolve, reject) => {
          const request = db
            .transaction(store, "readonly")
            .objectStore(store)
            .getAllKeys();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        chunks.push(JSON.stringify(keys), JSON.stringify(values));
      }
      db.close();
    }
    return chunks.join("\n");
  });
}

/** A fresh context per case: IndexedDB and the SW registration must not leak. */
async function freshPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return await context.newPage();
}

test("without encryption, the local datastore names your pages in the clear", async ({
  browser,
}) => {
  // The control for the test below. Without it, "the name is absent" would
  // also pass if the probe looked in the wrong place or nothing was ever
  // written — which is how an encryption test rots into a tautology. It
  // already earned its keep once: the first version of this pair asserted on
  // page *bodies*, and this case proved they are never in IndexedDB at all,
  // so its partner was passing for the wrong reason.
  const page = await freshPage(browser);
  try {
    await login(page, { encrypt: false });
    await writeMarker(page, "PlainProbe", "some body text");

    expect(
      await page.evaluate(() => localStorage.getItem("enableEncryption")),
    ).toBeNull();
    expect(await dumpIndexedDb(page)).toContain("PlainProbe");
  } finally {
    await page.context().close();
  }
});

test("with encryption, the local datastore does not name your pages", async ({
  browser,
}) => {
  const page = await freshPage(browser);
  try {
    await login(page, { encrypt: true });

    expect(
      await page.evaluate(() => localStorage.getItem("enableEncryption")),
    ).toBe("true");

    await writeMarker(page, "SecretProbe", "some body text");

    const dump = await dumpIndexedDb(page);
    // A datastore exists and was written to — otherwise the absence below
    // would just mean "nothing happened".
    expect(dump).toMatch(/sb_data_/);
    expect(dump.length).toBeGreaterThan(1000);
    expect(dump).not.toContain("SecretProbe");
  } finally {
    await page.context().close();
  }
});

test("the key survives a reload, and its loss sends you back to login", async ({
  browser,
}) => {
  const page = await freshPage(browser);
  try {
    await login(page, { encrypt: true });
    await writeMarker(page, "PersistProbe", "persistedmarker");

    // The worker still holds the key, so a reload boots straight back in and
    // decrypts what was written before it.
    await page.reload();
    await page
      .locator("#sb-editor .cm-editor")
      .waitFor({ state: "visible", timeout: 30_000 });
    await expect(page.locator("#sb-editor .cm-content")).toContainText(
      "persistedmarker",
    );

    // Drop the worker holding the key. The session cookie is untouched, so
    // this isolates "lost the key" from "lost the login": the client must
    // still bounce to the login page rather than boot without encryption.
    //
    // Two independent guards enforce that — boot.ts redirects when
    // `findEncryptionKey` comes back empty, and the service worker refuses to
    // configure without a key and broadcasts an `auth-error`. Disabling either
    // alone leaves this passing; it takes both to break it, which is the point
    // of having both.
    await page.evaluate(async () => {
      for (const registration of await navigator.serviceWorker.getRegistrations()) {
        await registration.unregister();
      }
    });
    await page.goto(`${base}/`);
    await expect(page).toHaveURL(/\/\.auth$/);
    await expect(page.locator("#username")).toBeVisible({ timeout: 30_000 });
  } finally {
    await page.context().close();
  }
});

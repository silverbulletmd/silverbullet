// Regenerates starter-kits/<id>/preview.png: a 1440x900 (720x450 CSS px at 2x) light-theme screenshot of
// each kit's index page, taken in a freshly booted server (needs `make build-e2e`).
//
//   npx tsx scripts/starter-kit-previews.ts [kit-id ...]
//
// Kits without a `preview` entry in their kit.json (Empty) are skipped.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, type Page } from "@playwright/test";
import {
  ADMIN_PASSWORD,
  ADMIN_USER,
  getFreePort,
  spawnServerProcess,
  waitForServer,
} from "../e2e/fixtures/core.ts";

const ROOT = join(import.meta.dirname, "..");
const KITS_DIR = join(ROOT, "starter-kits");
const WIDTH = 720;
const HEIGHT = 450;
const SCALE = 2;

const only = process.argv.slice(2);
const kits = readdirSync(KITS_DIR)
  .map((id) => ({
    id,
    preview: JSON.parse(readFileSync(join(KITS_DIR, id, "kit.json"), "utf8"))
      .preview as string | undefined,
  }))
  .filter((k) => k.preview && (only.length === 0 || only.includes(k.id)));

/** Resolves once the DOM text has stopped changing, i.e. live queries have rendered. */
async function waitForStable(page: Page) {
  await page.waitForFunction(
    async () => (globalThis as any).client.objectIndex.isIndexAvailable(),
    undefined,
    { timeout: 60_000 },
  );
  let previous = "";
  let stableSince = Date.now();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const current = await page.evaluate(
      () =>
        document.querySelector("#sb-main")?.textContent ??
        document.body.textContent ??
        "",
    );
    if (current !== previous) {
      previous = current;
      stableSince = Date.now();
    } else if (Date.now() - stableSince > 1500) return;
    await page.waitForTimeout(250);
  }
  throw new Error("page never settled");
}

/** Fills the throwaway space with neutral in-use content so the kit's queries show something. */
async function seedPersonalSpace(
  context: BrowserContext,
  base: string,
  prefix: string,
) {
  const files: Record<string, string> = {
    "Inbox/2026-11-18/09-12-03.md": "Call the plumber about the leak\n",
    "Inbox/2026-11-18/11-40-27.md":
      "Ideas for the garden\n\nMore tomatoes, a herb bed by the door.\n",
    "Inbox/2026-11-17/16-05-51.md": "Book dentist appointment\n",
    "Journal/2026-11-18.md":
      '---\ntags: journal\ndate: "2026-11-18"\n---\n* Slow morning, planned the week.\n',
    "Inbox/2026-11-18/14-22-09.md":
      "Weekend errands\n\n* [ ] Buy paint for the shed\n* [ ] Return the library books\n",
  };
  for (const [path, body] of Object.entries(files)) {
    const r = await context.request.put(`${base}${prefix}/.fs/${path}`, {
      data: body,
    });
    if (!r.ok()) throw new Error(`seed ${path}: ${r.status()}`);
  }
}

const dataRoot = await mkdtemp(join(tmpdir(), "sb-previews-"));
execFileSync(
  "./target/debug/silverbullet",
  ["setup", dataRoot, "--admin", `${ADMIN_USER}:${ADMIN_PASSWORD}`],
  { cwd: ROOT, stdio: "pipe" },
);
const port = await getFreePort();
const server = spawnServerProcess(dataRoot, port);
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ args: ["--disable-dev-shm-usage"] });
try {
  await waitForServer(`${base}/.dashboard`);
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    colorScheme: "light",
    deviceScaleFactor: SCALE,
  });
  const login = await context.request.post(`${base}/.dashboard/api/login`, {
    data: { username: ADMIN_USER, password: ADMIN_PASSWORD },
  });
  if (!login.ok()) throw new Error(`login failed: ${login.status()}`);
  for (const { id, preview } of kits) {
    const prefix = `/kit-${id}`;
    const created = await context.request.post(
      `${base}/.dashboard/api/admin/spaces`,
      {
        data: {
          name: id,
          binding: { prefix },
          starter: { type: "kit", id },
        },
      },
    );
    if (!created.ok()) throw new Error(await created.text());
    if (id === "personal-space") await seedPersonalSpace(context, base, prefix);
    const page = await context.newPage();
    await page.goto(`${base}${prefix}/?headless=1`);
    await page.locator("#sb-editor .cm-editor").waitFor({ timeout: 30_000 });
    await waitForStable(page);
    await page.addStyleTag({
      content:
        ".sb-notifications, .sb-notification { display: none !important; } * { caret-color: transparent !important; } .cm-cursor, .cm-cursor-primary { display: none !important; }",
    });
    if (id === "personal-space") {
      // The welcome prose is not the selling point: start at the quick notes.
      await page.evaluate(() => {
        const heading = [...document.querySelectorAll(".cm-line")].find((l) =>
          l.textContent?.includes("Recent quick notes"),
        );
        const scroller = document.querySelector(".cm-scroller");
        if (heading && scroller)
          scroller.scrollTop +=
            heading.getBoundingClientRect().top -
            scroller.getBoundingClientRect().top -
            8;
      });
      await page.waitForTimeout(500);
    }
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.addStyleTag({
      content: "*:focus, *:focus-visible { outline: none !important; }",
    });
    await page.mouse.move(WIDTH - 1, HEIGHT - 1);
    await page.screenshot({ path: join(KITS_DIR, id, preview as string) });
    console.log(`wrote starter-kits/${id}/${preview}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.kill("SIGTERM");
  rmSync(dataRoot, { recursive: true, force: true });
}

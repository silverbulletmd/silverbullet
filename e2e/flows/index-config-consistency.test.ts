import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test, type SBServer } from "../fixtures/core.ts";

// Every client on one origin drains the same indexQueue, and each applies its
// own Space Lua snapshot while doing so. A reindex spread across clients
// therefore writes two rule sets into one index.

// Below about 100 pages, a reindex can finish before the late client in the
// mid-reindex test has booted, and that test then passes without the fix.
const PAGES = 100;

const spaceFiles: Record<string, string> = {
  "index.md": "# Home\n",
};
for (let i = 0; i < PAGES; i++) {
  const n = String(i).padStart(4, "0");
  spaceFiles[`p${n}.md`] = `# Page ${n}\n\nBody for page ${n}.\n`;
}

const transformPage = `\`\`\`space-lua
tag.define {
  name = "page",
  transform = function(o)
    o.probeMark = "y"
    return o
  end,
}
\`\`\`
`;

const evalLua = (page: Page, expr: string): Promise<any> =>
  page.evaluate((e) => (globalThis as any).sbRuntime.evalLua(e), expr);

const runLua = (page: Page, code: string): Promise<any> =>
  page.evaluate((c) => (globalThis as any).sbRuntime.evalLuaScript(c), code);

async function tryEval(page: Page, expr: string): Promise<any> {
  try {
    return await evalLua(page, expr);
  } catch {
    // Querying before the index is up throws from inside Lua; that means
    // "not ready", not "not there".
    return null;
  }
}

/**
 * Not `gotoSilverBulletPage`: its readiness wait does not settle after a
 * re-navigation. Both clients must share one browser context. With separate
 * storage they have no shared index queue, and the tests pass without the fix.
 */
async function openClient(page: Page, server: SBServer): Promise<void> {
  await page.goto(`${server.url}/index?headless=1`);
  await page.waitForFunction(
    () => typeof (globalThis as any).sbRuntime?.evalLua === "function",
    null,
    { timeout: 60_000 },
  );
  await expect.poll(() => tryEval(page, "1 + 1"), { timeout: 60_000 }).toBe(2);
}

const pageIsIndexed = (page: Page, name: string) =>
  tryEval(page, `#query[[from p = index.pages() where p.name == "${name}"]]`);

const hasPageTransform = (page: Page): Promise<boolean> =>
  page.evaluate(
    () =>
      !!(globalThis as any).client.config.get(
        ["tags", "page", "transform"],
        undefined,
      ),
  );

test.describe("index consistency across clients", () => {
  test.use({ spaceFiles });
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Coordination uses the Web Locks API",
  );

  test("a reindex applies one Space Lua snapshot, not one per client", async ({
    page,
    sbServer,
  }) => {
    test.setTimeout(180_000);

    await openClient(page, sbServer);
    // Same context on purpose: one origin, one IndexedDB, one index queue.
    const stale = await page.context().newPage();
    await openClient(stale, sbServer);

    await expect
      .poll(
        () => pageIsIndexed(page, `p${String(PAGES - 1).padStart(4, "0")}`),
        {
          timeout: 120_000,
        },
      )
      .toBeGreaterThan(0);

    // A transform neither client has loaded yet.
    await writeFile(join(sbServer.spaceDir, "Transform.md"), transformPage);
    await expect
      .poll(() => pageIsIndexed(page, "Transform"), { timeout: 120_000 })
      .toBeGreaterThan(0);

    // Only one of the two clients picks it up.
    await openClient(page, sbServer);
    await runLua(page, "index.reindexSpace()");

    const total = await evalLua(page, "#query[[from p = index.pages()]]");
    const marked = await evalLua(
      page,
      '#query[[from p = index.pages() where p.probeMark == "y"]]',
    );
    expect(total).toBeGreaterThan(PAGES);
    // Without coordination the client still running the old snapshot indexes
    // its share of the queue, and those pages come out untransformed.
    expect(marked).toBe(total);
  });

  test("a client that opens mid-reindex does not write untransformed pages", async ({
    page,
    sbServer,
  }) => {
    test.setTimeout(180_000);

    await writeFile(join(sbServer.spaceDir, "Transform.md"), transformPage);
    await openClient(page, sbServer);
    await expect
      .poll(
        () => pageIsIndexed(page, `p${String(PAGES - 1).padStart(4, "0")}`),
        {
          timeout: 120_000,
        },
      )
      .toBeGreaterThan(0);
    await expect
      .poll(() => pageIsIndexed(page, "Transform"), { timeout: 120_000 })
      .toBeGreaterThan(0);
    await openClient(page, sbServer);

    // A client booting into a reindex finds no index version, so its script
    // load bails -- but its queue subscription came up with the plugs, so
    // without coordination it indexes with no tag rules at all.
    const latecomer = await page.context().newPage();
    const opened = (async () => {
      await new Promise((r) => setTimeout(r, 400));
      await latecomer.goto(`${sbServer.url}/index?headless=1`);
    })();

    await runLua(page, "index.reindexSpace()");
    await opened;

    const total = await evalLua(page, "#query[[from p = index.pages()]]");
    const marked = await evalLua(
      page,
      '#query[[from p = index.pages() where p.probeMark == "y"]]',
    );
    expect(total).toBeGreaterThan(PAGES);
    expect(marked).toBe(total);
  });

  test("reloading scripts in one client reloads them in the others", async ({
    page,
    sbServer,
  }) => {
    test.setTimeout(180_000);

    await openClient(page, sbServer);
    const other = await page.context().newPage();
    await openClient(other, sbServer);
    await expect
      .poll(
        () => pageIsIndexed(page, `p${String(PAGES - 1).padStart(4, "0")}`),
        {
          timeout: 120_000,
        },
      )
      .toBeGreaterThan(0);

    // The other client holds a memoized scan from before the new script was
    // indexed, which is what a reload there would read unless it bypasses the
    // memo. Left alone the memo expires within seconds, and a client's own
    // index write clears it, so the other client's TTL is held open and it is
    // kept off the queue until its reload is done.
    await other.evaluate(() => {
      const objectIndex = (globalThis as any).client.objectIndex;
      objectIndex.scanMemoTTLMs = 600_000;
      objectIndex.isForeignReindexRunning = async () => true;
    });
    await evalLua(other, '#query[[from s = index.tag "space-lua"]]');

    await writeFile(join(sbServer.spaceDir, "Transform.md"), transformPage);
    await expect
      .poll(() => pageIsIndexed(page, "Transform"), { timeout: 120_000 })
      .toBeGreaterThan(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (globalThis as any).client.mq.isQueueEmpty("indexQueue"),
        ),
      )
      .toBe(true);
    expect(await hasPageTransform(other)).toBe(false);

    await runLua(page, "system.loadScripts()");
    await expect
      .poll(() => hasPageTransform(other), { timeout: 10_000 })
      .toBe(true);
    await other.evaluate(() => {
      delete (globalThis as any).client.objectIndex.isForeignReindexRunning;
    });

    // With the reloading client gone, a page saved from now on can only be
    // indexed by the other one, under whatever rules it holds.
    await page.close();
    await writeFile(join(sbServer.spaceDir, "Fresh.md"), "# Fresh\n");
    await expect
      .poll(
        () =>
          tryEval(
            other,
            '#query[[from p = index.pages() where p.name == "Fresh" and p.probeMark == "y"]]',
          ),
        { timeout: 60_000 },
      )
      .toBe(1);
  });
});

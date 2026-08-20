import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Browser,
  type BrowserContext,
  type ChildProcess,
  expect,
  type Page,
  test,
} from "@playwright/test";
import {
  getFreePort,
  type SpawnServerOptions,
  spawnServerProcess,
  waitForServer,
} from "./fixtures.ts";

// SilverBullet's own keymap binds doc-start/doc-end to "Ctrl-Home"/"Ctrl-End"
// on every platform (with Cmd-ArrowUp/Down as additional Mac aliases) --
// NOT the browser-native "Mod-Home"/"Mod-End" (Cmd-Home on Mac does
// nothing here). See "Editor: Cursor Doc Start"/"Doc End" in
// editor_commands.ts.
const DOC_START = "Control+Home";
const DOC_END = "Control+End";

/**
 * Two real browser contexts (independent service workers + IndexedDBs, "A"
 * and "B") against one spawned server, proving the collaboration stack end
 * to end: propagation, non-overlapping auto-merge, identical conflict
 * markers, and resolution round-trip. The service worker must stay ENABLED
 * throughout -- it's what runs the sync engine these scenarios exercise --
 * so unlike most of the e2e suite this never sets
 * SB_DISABLE_SERVICE_WORKER and never navigates with `?headless=1` (that
 * query param skips SW *registration* on the navigation that carries it).
 *
 * The four scenarios share one page and run in one `describe.serial` block,
 * each building on the document state the previous one converged to.
 */

const PAGE_NAME = "CollabPage";
const PAGE_PATH = `${PAGE_NAME}.md`;
const SEED_CONTENT = "Line1 original\nLine2 original\nLine3 original\n";
const CONFLICT_START = "<<<<<<< SB sha256:";
const CONFLICT_BASE = "||||||| SB BASE sha256:";
const CONFLICT_END = ">>>>>>> SB sha256:";

let proc: ChildProcess;
let spaceDir: string;
let base: string;

async function readViaContext(page: Page, pagePath: string): Promise<string> {
  return await page.evaluate(async (p) => {
    // Without this header the SW's proxy router treats a bare `.md` /.fs
    // request as a stray address-bar navigation and redirects to the app
    // shell instead of answering with the raw file (see proxy_router.ts).
    const resp = await fetch(p, {
      cache: "no-store",
      headers: { "X-Sync-Mode": "true" },
    });
    if (!resp.ok) {
      throw new Error(`fetch ${p} failed: ${resp.status}`);
    }
    return await resp.text();
  }, `/.fs/${pagePath}`);
}

async function readFromServer(
  pagePath: string,
  baseUrl: string,
): Promise<string> {
  const resp = await fetch(`${baseUrl}/.fs/${pagePath}`, {
    cache: "no-store",
  });
  if (!resp.ok) {
    throw new Error(`fetch ${pagePath} from server failed: ${resp.status}`);
  }
  return await resp.text();
}

/** A raw write straight to the server, bypassing every open browser context. */
async function remotePut(
  baseUrl: string,
  pagePath: string,
  content: string,
): Promise<void> {
  const resp = await fetch(`${baseUrl}/.fs/${pagePath}`, {
    method: "PUT",
    headers: { "X-Sync-Mode": "true" },
    body: content,
  });
  if (!resp.ok) {
    throw new Error(`remote write to ${pagePath} failed: ${resp.status}`);
  }
}

/**
 * Attach a listener for the SW's "space-sync-complete" broadcast *before*
 * any page script runs, via `addInitScript` -- otherwise a fast first sync
 * can fire the message before a post-navigation listener gets attached.
 */
async function primeInitialSyncWaiter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    (window as any).__sbInitialSync = new Promise<void>((resolve) => {
      navigator.serviceWorker.addEventListener(
        "message",
        function handler(event: MessageEvent) {
          if (event.data?.type === "space-sync-complete") {
            navigator.serviceWorker.removeEventListener("message", handler);
            resolve();
          }
        },
      );
    });
  });
}

async function openLiveClientPage(page: Page, baseUrl: string): Promise<void> {
  await primeInitialSyncWaiter(page);
  await page.goto(`${baseUrl}/${PAGE_NAME}`);
  await page
    .locator("#sb-editor .cm-editor")
    .waitFor({ state: "visible", timeout: 30_000 });
  // `waitForEditorReady`/`sbRuntime.ready` is a headless-mode-only signal
  // (see client.ts's initHeadlessRuntime) -- unavailable here since this
  // spec deliberately never navigates with `?headless=1`. The seeded
  // content actually rendering is the readiness signal instead.
  await expect(page.locator("#sb-editor .cm-content")).toContainText(
    "Line1 original",
    { timeout: 30_000 },
  );
  await page.waitForFunction(
    () => !!navigator.serviceWorker.controller,
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate(() => (window as any).__sbInitialSync);
}

/** Wait for a full unsaved -> saved autosave round trip on the given page. */
async function waitForSaveRoundtrip(page: Page): Promise<void> {
  const sel = "#sb-current-page";
  await page
    .locator(`${sel}.sb-unsaved`)
    .waitFor({ state: "attached", timeout: 10_000 });
  await page
    .locator(`${sel}.sb-saved`)
    .waitFor({ state: "attached", timeout: 10_000 });
}

async function typeAtStart(page: Page, text: string): Promise<void> {
  const editor = page.locator("#sb-editor .cm-content");
  await editor.click();
  await page.keyboard.press(DOC_START);
  await page.keyboard.type(`${text}\n`);
  await waitForSaveRoundtrip(page);
}

async function typeAtEnd(page: Page, text: string): Promise<void> {
  const editor = page.locator("#sb-editor .cm-content");
  await editor.click();
  await page.keyboard.press(DOC_END);
  await page.keyboard.type(`\n${text}`);
  await waitForSaveRoundtrip(page);
}

/**
 * Selects the whole line at zero-based `lineIndex` (counting from the very
 * top of the document) and replaces it with `text`. Leaves the cursor back
 * at the document start: the conflict-marker decorator hides its widget
 * while the cursor overlaps the hunk, and doc-start is guaranteed to be
 * outside any hunk this produces.
 */
async function replaceLine(
  page: Page,
  lineIndex: number,
  text: string,
): Promise<void> {
  const editor = page.locator("#sb-editor .cm-content");
  await editor.click();
  await page.keyboard.press(DOC_START);
  for (let i = 0; i < lineIndex; i++) {
    await page.keyboard.press("ArrowDown");
  }
  await page.keyboard.press("Home");
  await page.keyboard.press("Shift+End");
  await page.keyboard.type(text);
  await page.keyboard.press(DOC_START);
  await waitForSaveRoundtrip(page);
}

/**
 * Replaces the whole line at zero-based `lineIndex` in one atomic CodeMirror
 * transaction, dispatched directly via `window.client.editorView` (exposed
 * unconditionally in boot.ts) instead of simulated keystrokes. Needed
 * wherever the test also races an out-of-band write against this edit:
 * a multi-keystroke `page.keyboard.type()` spans several real round trips,
 * and an external patch (from that other write syncing in) landing *between*
 * two of those keystrokes interleaves with the in-flight transaction instead
 * of merging cleanly against it -- a single dispatch can't be interrupted
 * like that. Leaves the cursor at doc start for the same reason
 * `replaceLine` does: the decorator hides its widget while the cursor sits
 * inside the hunk.
 */
async function replaceLineAtomic(
  page: Page,
  lineIndex: number,
  text: string,
): Promise<void> {
  await page.evaluate(
    ({ lineIndex, text }) => {
      const view = (window as any).client.editorView;
      const line = view.state.doc.line(lineIndex + 1);
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: text },
        selection: { anchor: 0 },
      });
    },
    { lineIndex, text },
  );
  await waitForSaveRoundtrip(page);
}

test.describe("Two-context live-SW collaboration sync", () => {
  test.describe.configure({ mode: "serial", timeout: 120_000 });
  // Real SW + two-context behavior is only asserted for Chromium; see
  // pwa-offline.test.ts for the same restriction and rationale.
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Live service worker collaboration sync only runs on Chromium",
  );

  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    spaceDir = await mkdtemp(join(tmpdir(), "sb-collab-sync-e2e-"));
    await writeFile(join(spaceDir, PAGE_PATH), SEED_CONTENT);

    const port = await getFreePort();
    const opts: SpawnServerOptions = { disableServiceWorker: false };
    proc = spawnServerProcess(spaceDir, port, opts);
    base = `http://127.0.0.1:${port}`;
    await waitForServer(`${base}/.ping`);

    contextA = await browser.newContext();
    contextB = await browser.newContext();
    pageA = await contextA.newPage();
    pageB = await contextB.newPage();

    await openLiveClientPage(pageA, base);
    await openLiveClientPage(pageB, base);
  });

  test.afterAll(async () => {
    await contextA?.close();
    await contextB?.close();
    proc?.kill("SIGTERM");
    await rm(spaceDir, { recursive: true, force: true });
  });

  /**
   * Polls until A's context, B's context, and the server itself all read
   * back byte-identical content for the page (optionally also matching
   * `predicate`), then re-asserts the equalities directly so a failure
   * reports the actual mismatch rather than just "poll timed out".
   */
  async function expectConverged(
    predicate?: (content: string) => boolean,
  ): Promise<string> {
    await expect
      .poll(
        async () => {
          const [a, b, server] = await Promise.all([
            readViaContext(pageA, PAGE_PATH),
            readViaContext(pageB, PAGE_PATH),
            readFromServer(PAGE_PATH, base),
          ]);
          if (a !== b || b !== server) return "diverged";
          if (predicate && !predicate(a)) return "not-matching";
          return "converged";
        },
        { timeout: 45_000, intervals: [500, 1000, 2000] },
      )
      .toBe("converged");

    const [a, b, server] = await Promise.all([
      readViaContext(pageA, PAGE_PATH),
      readViaContext(pageB, PAGE_PATH),
      readFromServer(PAGE_PATH, base),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(server);
    return a;
  }

  test("1. propagation: A's edit appears in B and matches the server", async () => {
    await typeAtEnd(pageA, "Paragraph from A");

    await expect(pageB.locator("#sb-editor .cm-content")).toContainText(
      "Paragraph from A",
      { timeout: 45_000 },
    );

    const content = await expectConverged((c) =>
      c.includes("Paragraph from A"),
    );
    expect(content).not.toContain(CONFLICT_START);
  });

  test("2. non-overlapping concurrent edits converge without a conflict", async () => {
    await Promise.all([
      typeAtStart(pageA, "Top edit by A"),
      typeAtEnd(pageB, "Bottom edit by B"),
    ]);

    await expect(pageA.locator("#sb-editor .cm-content")).toContainText(
      "Bottom edit by B",
      { timeout: 45_000 },
    );
    await expect(pageB.locator("#sb-editor .cm-content")).toContainText(
      "Top edit by A",
      { timeout: 45_000 },
    );

    const content = await expectConverged(
      (c) => c.includes("Top edit by A") && c.includes("Bottom edit by B"),
    );
    expect(content).not.toContain(CONFLICT_START);
  });

  test("3. overlapping same-line edits produce one identical conflict hunk, widget visible on both sides", async () => {
    // At this point the doc is:
    //   Top edit by A / Line1 original / Line2 original / Line3 original /
    //   Paragraph from A / Bottom edit by B
    // "Line2 original" is line index 2.
    await Promise.all([
      replaceLine(pageA, 2, "Line2 changed by A"),
      replaceLine(pageB, 2, "Line2 changed by B"),
    ]);

    await expect(pageA.locator(".sb-conflict-widget")).toBeVisible({
      timeout: 45_000,
    });
    await expect(pageB.locator(".sb-conflict-widget")).toBeVisible({
      timeout: 45_000,
    });

    const content = await expectConverged((c) => {
      const hunks = c.split(CONFLICT_START).length - 1;
      return hunks === 1;
    });
    expect(content).toContain("Line2 changed by A");
    expect(content).toContain("Line2 changed by B");
    expect(content).toContain(CONFLICT_BASE);
    expect(content).toContain(CONFLICT_END);
  });

  test("4. resolution round-trip: accepting a version in A clears the conflict everywhere", async () => {
    await pageA.getByRole("button", { name: "Accept Version 1" }).click();
    await waitForSaveRoundtrip(pageA);

    await expect(pageA.locator(".sb-conflict-widget")).toHaveCount(0);
    await expect(pageB.locator(".sb-conflict-widget")).toHaveCount(0, {
      timeout: 45_000,
    });

    const content = await expectConverged((c) => !c.includes(CONFLICT_START));
    expect(content).not.toContain(CONFLICT_START);
    expect(content).not.toContain(CONFLICT_BASE);
    expect(content).not.toContain(CONFLICT_END);
    expect(
      content.includes("Line2 changed by A") ||
        content.includes("Line2 changed by B"),
    ).toBe(true);
  });
});

/**
 * One browser context, two pages (tabs) on the same origin -- same-origin
 * pages share exactly one service worker registration, so tab1 and tab2
 * share one running sync engine. This covers the design spec's "two Core
 * tabs sharing one service worker" bullet: a write from either side (a
 * same-origin tab, or an outside actor writing straight to the server)
 * reaches both tabs through that one shared scheduler, and a sync-conflict
 * notification broadcasts to both windows, not just the one that typed.
 */
test.describe("Two tabs sharing one service worker", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Live service worker collaboration sync only runs on Chromium",
  );

  let proc2: ChildProcess;
  let spaceDir2: string;
  let base2: string;
  let context: BrowserContext;
  let tab1: Page;
  let tab2: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    spaceDir2 = await mkdtemp(join(tmpdir(), "sb-collab-tabs-e2e-"));
    await writeFile(join(spaceDir2, PAGE_PATH), SEED_CONTENT);

    const port = await getFreePort();
    const opts: SpawnServerOptions = { disableServiceWorker: false };
    proc2 = spawnServerProcess(spaceDir2, port, opts);
    base2 = `http://127.0.0.1:${port}`;
    await waitForServer(`${base2}/.ping`);

    context = await browser.newContext();
    tab1 = await context.newPage();
    tab2 = await context.newPage();

    await openLiveClientPage(tab1, base2);
    await openLiveClientPage(tab2, base2);
  });

  test.afterAll(async () => {
    await context?.close();
    proc2?.kill("SIGTERM");
    await rm(spaceDir2, { recursive: true, force: true });
  });

  /** A raw write straight to the server, bypassing both tabs and their shared SW. */
  async function remoteWrite(content: string): Promise<void> {
    const resp = await fetch(`${base2}/.fs/${PAGE_PATH}`, {
      method: "PUT",
      headers: { "X-Sync-Mode": "true" },
      body: content,
    });
    if (!resp.ok) {
      throw new Error(`remote write failed: ${resp.status}`);
    }
  }

  test("a local edit in tab1 reaches the server, and a remote write reaches both tabs", async () => {
    await typeAtEnd(tab1, "Paragraph from tab1");

    await expect
      .poll(
        async () =>
          (await readFromServer(PAGE_PATH, base2)).includes(
            "Paragraph from tab1",
          ),
        { timeout: 45_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);

    // A write from neither tab -- simulates a third actor (another device,
    // a script) writing directly against the server. Only one sync engine
    // is running (one SW, shared by both tabs), so its next cycle should
    // pull this in and broadcast the update to every window, not just
    // whichever tab happens to have made the most recent local edit.
    const before = await readFromServer(PAGE_PATH, base2);
    await remoteWrite(`${before}\nRemote write from outside either tab`);

    await expect(tab1.locator("#sb-editor .cm-content")).toContainText(
      "Remote write from outside either tab",
      { timeout: 45_000 },
    );
    await expect(tab2.locator("#sb-editor .cm-content")).toContainText(
      "Remote write from outside either tab",
      { timeout: 45_000 },
    );

    // Deduplicated-work check: one shared scheduler produced one canonical
    // result at quiescence, not a race between duplicate/competing syncs.
    const [serverContent, tab1Content, tab2Content, listing] =
      await Promise.all([
        readFromServer(PAGE_PATH, base2),
        readViaContext(tab1, PAGE_PATH),
        readViaContext(tab2, PAGE_PATH),
        fetch(`${base2}/.fs`).then((r) => r.json()) as Promise<
          Array<{ name: string }>
        >,
      ]);
    expect(tab1Content).toBe(serverContent);
    expect(tab2Content).toBe(serverContent);
    expect(serverContent).not.toContain(CONFLICT_START);
    expect(listing.filter((f) => f.name.startsWith(PAGE_NAME))).toHaveLength(1);
  });

  // The previously-fixme'd sibling of this test drove the shared engine
  // into a fast-forward instead of a conflict, and the editor merge then
  // spliced the two sides into "Line2 changed by Remchaned by Tteb1". The
  // splice is fixed in external_merge.ts and pinned by unit tests there
  // (which can set up an editor buffer diverged from its disk base
  // directly); this test covers the sync-level behavior it was written
  // for, and asserts tab1's buffer matches the marker document byte for
  // byte so no interleaving can hide in the converged result.
  test("a sync conflict broadcasts the same notification to both tabs", async () => {
    const before = await readFromServer(PAGE_PATH, base2);
    const lines = before.split("\n");
    const targetIndex = lines.indexOf("Line2 original");
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    const remoteLines = [...lines];
    remoteLines[targetIndex] = "Line2 changed by Remote";

    // Both tabs share one context, so this parks the single service worker
    // they share: tab1's edit still reaches the local store and the dirty
    // queue, but can't be pushed, and the remote write below can't be
    // pulled. Sequencing the two writes without it doesn't produce a
    // conflict at all -- the pull wins the race, the engine fast-forwards
    // the local store onto the remote revision, and tab1's later push is a
    // clean overwrite. Going offline is also the honest shape of this
    // scenario: an edit made while disconnected, racing a change made
    // elsewhere in the meantime.
    await context.setOffline(true);
    await replaceLineAtomic(tab1, targetIndex, "Line2 changed by Tab1");
    await remoteWrite(remoteLines.join("\n"));

    // The SW's syncConflict event broadcasts to every window client of
    // the one shared service worker (see broadcastMessage in
    // service_worker.ts) -- both tabs should flash the same notice, not
    // just the one that typed. Armed before reconnecting: notifications
    // auto-dismiss, so waiting on them only after the widget assertions
    // below would race the dismissal.
    const noticed = Promise.all([
      expect(
        tab1.locator(".sb-notification-error", { hasText: "Sync conflict" }),
      ).toBeVisible({ timeout: 60_000 }),
      expect(
        tab2.locator(".sb-notification-error", { hasText: "Sync conflict" }),
      ).toBeVisible({ timeout: 60_000 }),
    ]);

    await context.setOffline(false);
    await noticed;

    await expect(tab1.locator(".sb-conflict-widget")).toBeVisible({
      timeout: 60_000,
    });
    await expect(tab2.locator(".sb-conflict-widget")).toBeVisible({
      timeout: 60_000,
    });

    await expect
      .poll(() => readFromServer(PAGE_PATH, base2), {
        timeout: 60_000,
        intervals: [500, 1000, 2000],
      })
      .toContain(CONFLICT_START);

    const serverContent = await readFromServer(PAGE_PATH, base2);
    const [tab1Content, tab2Content] = await Promise.all([
      readViaContext(tab1, PAGE_PATH),
      readViaContext(tab2, PAGE_PATH),
    ]);
    expect(tab1Content).toBe(serverContent);
    expect(tab2Content).toBe(serverContent);
    expect(serverContent.split(CONFLICT_START).length - 1).toBe(1);
    expect(serverContent).toContain(CONFLICT_BASE);
    expect(serverContent).toContain(CONFLICT_END);
    expect(serverContent).toContain("Line2 changed by Tab1");
    expect(serverContent).toContain("Line2 changed by Remote");

    // The regression itself: tab1's own buffer held its side of this very
    // conflict when the marker document arrived. Its editor doc must be the
    // marker document byte for byte -- pre-fix it was an interleaving of
    // both sides ("Line2 changed by Remchaned by Tteb1").
    const tab1Doc = await tab1.evaluate(
      () => (window as any).client.editorView.state.sliceDoc() as string,
    );
    expect(tab1Doc).toBe(serverContent);
  });
});

/**
 * The ordering the offline test above deliberately can't reach: everything
 * stays online, and the remote revision is pulled into the local replica
 * *before* the editor's autosave writes its own version of the same line.
 *
 * Left alone this is a silent last-writer-wins. The editor withholds the
 * colliding update (correctly -- merging it would splice both sides), the
 * autosave then overwrites the pulled revision in IndexedDB, and the sync
 * engine pushes that as a clean fast-forward because its recorded remote
 * revision still matches the server's. No 412, no reconciliation, no conflict
 * file: the other participant's edit is simply gone.
 *
 * Own context and server: it leaves a conflict-marked document behind, which
 * the serial blocks above would then have to edit around.
 */
test.describe("Autosave landing on top of a pulled remote revision", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Live service worker collaboration sync only runs on Chromium",
  );

  let proc3: ChildProcess;
  let spaceDir3: string;
  let base3: string;
  let context3: BrowserContext;
  let tab: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    spaceDir3 = await mkdtemp(join(tmpdir(), "sb-collab-clobber-e2e-"));
    await writeFile(join(spaceDir3, PAGE_PATH), SEED_CONTENT);

    const port = await getFreePort();
    const opts: SpawnServerOptions = { disableServiceWorker: false };
    proc3 = spawnServerProcess(spaceDir3, port, opts);
    base3 = `http://127.0.0.1:${port}`;
    await waitForServer(`${base3}/.ping`);

    context3 = await browser.newContext();
    tab = await context3.newPage();
    await openLiveClientPage(tab, base3);
  });

  test.afterAll(async () => {
    await context3?.close();
    proc3?.kill("SIGTERM");
    await rm(spaceDir3, { recursive: true, force: true });
  });

  test("both edits survive when the autosave fires after the pull", async () => {
    // Hold the autosave so the pull is guaranteed to win the race. Real users
    // hit this whenever the remote change lands inside the one-second
    // debounce; freezing it makes that ordering deterministic instead of
    // depending on how fast the engine happens to be.
    await tab.evaluate(() => {
      const cm = (window as any).client.contentManager;
      clearTimeout(cm.saveTimeout);
      (window as any).__sbRealSave = cm.save.bind(cm);
      cm.save = () => Promise.resolve();
    });

    await tab.evaluate(() => {
      const view = (window as any).client.editorView;
      const line = view.state.doc.line(2);
      view.dispatch({
        changes: { from: line.from, to: line.to, insert: "Line2 changed here" },
        selection: { anchor: 0 },
      });
    });
    await tab.locator("#sb-current-page.sb-unsaved").waitFor({
      state: "attached",
      timeout: 10_000,
    });

    // A third actor rewrites the same line straight on the server.
    const remote = SEED_CONTENT.replace(
      "Line2 original",
      "Line2 changed by Remote",
    );
    const resp = await fetch(`${base3}/.fs/${PAGE_PATH}`, {
      method: "PUT",
      headers: { "X-Sync-Mode": "true" },
      body: remote,
    });
    expect(resp.ok).toBe(true);

    // Wait for the engine to pull that revision into the local replica.
    await expect
      .poll(() => readViaContext(tab, PAGE_PATH), {
        timeout: 60_000,
        intervals: [250, 500, 1000],
      })
      .toContain("Line2 changed by Remote");

    // Deliver it to the editor through the very call the file:changed
    // listener makes (see client.ts), so the merge attempt happens at a known
    // point rather than whenever the file watcher next ticks.
    await tab.evaluate(() =>
      (window as any).client.contentManager.reloadPageContent("external"),
    );

    // Withheld, not spliced: the buffer keeps its own line.
    const bufferAfterPull = await tab.evaluate(
      () => (window as any).client.editorView.state.sliceDoc() as string,
    );
    expect(bufferAfterPull).toContain("Line2 changed here");
    expect(bufferAfterPull).not.toContain("Line2 changed by Remote");

    // Now let the autosave through, on top of the pulled revision.
    await tab.evaluate(async () => {
      const cm = (window as any).client.contentManager;
      cm.save = (window as any).__sbRealSave;
      await cm.save(true);
    });

    // The invariant: whatever the converged document turns out to be -- a
    // clean merge or one conflict hunk -- neither edit may be missing from
    // it. Pre-fix the server ends up holding only "Line2 changed here".
    await expect
      .poll(() => readFromServer(PAGE_PATH, base3), {
        timeout: 60_000,
        intervals: [500, 1000, 2000],
      })
      .toContain("Line2 changed by Remote");

    const serverContent = await readFromServer(PAGE_PATH, base3);
    expect(serverContent).toContain("Line2 changed here");
    expect(serverContent).toContain("Line2 changed by Remote");

    // ...and the editor converges on those same bytes.
    await expect
      .poll(
        async () =>
          await tab.evaluate(
            () => (window as any).client.editorView.state.sliceDoc() as string,
          ),
        { timeout: 60_000, intervals: [500, 1000, 2000] },
      )
      .toBe(serverContent);
  });
});

/**
 * A true offline/rejoin scenario, distinct from the forced-offline conflict
 * test above: context A goes offline via CDP-level network emulation, edits
 * accumulate locally (across two pages) while nothing can reach the server,
 * and a remote actor changes the *same* page in the meantime. Rejoining
 * exercises the recovery path setOffline(false) drives -- the browser's
 * 'online' event fires, which RealtimeEvents listens for to reconnect its
 * EventSource immediately instead of waiting out its backoff, and the SW's
 * queued local edits meet a server that has moved on.
 */
test.describe("Offline rejoin: edits merge after reconnecting", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Live service worker collaboration sync only runs on Chromium",
  );

  const PAGE2_NAME = "CollabPage2";
  const PAGE2_PATH = `${PAGE2_NAME}.md`;
  const SEED2_CONTENT = "Second page original content\n";

  let proc4: ChildProcess;
  let spaceDir4: string;
  let base4: string;
  let contextA4: BrowserContext;
  let contextB4: BrowserContext;
  let pageA4: Page;
  let pageB4: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    spaceDir4 = await mkdtemp(join(tmpdir(), "sb-collab-offline-e2e-"));
    await writeFile(join(spaceDir4, PAGE_PATH), SEED_CONTENT);
    await writeFile(join(spaceDir4, PAGE2_PATH), SEED2_CONTENT);

    const port = await getFreePort();
    const opts: SpawnServerOptions = { disableServiceWorker: false };
    proc4 = spawnServerProcess(spaceDir4, port, opts);
    base4 = `http://127.0.0.1:${port}`;
    await waitForServer(`${base4}/.ping`);

    contextA4 = await browser.newContext();
    contextB4 = await browser.newContext();
    pageA4 = await contextA4.newPage();
    pageB4 = await contextB4.newPage();

    await openLiveClientPage(pageA4, base4);
    await openLiveClientPage(pageB4, base4);

    // Prefetch page2 into A's local store while still online, so the SW can
    // serve it from local data once A goes offline (mirrors
    // pwa-offline.test.ts's "navigates to another page while offline").
    await pageA4.goto(`${base4}/${PAGE2_NAME}`);
    await expect(pageA4.locator("#sb-editor .cm-content")).toContainText(
      "Second page original content",
      { timeout: 30_000 },
    );
    await pageA4.goto(`${base4}/${PAGE_NAME}`);
    await expect(pageA4.locator("#sb-editor .cm-content")).toContainText(
      "Line1 original",
      { timeout: 30_000 },
    );
  });

  test.afterAll(async () => {
    await contextA4?.close();
    await contextB4?.close();
    proc4?.kill("SIGTERM");
    await rm(spaceDir4, { recursive: true, force: true });
  });

  async function expectConverged4(
    predicate?: (content: string) => boolean,
  ): Promise<string> {
    await expect
      .poll(
        async () => {
          const [a, b, server] = await Promise.all([
            readViaContext(pageA4, PAGE_PATH),
            readViaContext(pageB4, PAGE_PATH),
            readFromServer(PAGE_PATH, base4),
          ]);
          if (a !== b || b !== server) return "diverged";
          if (predicate && !predicate(a)) return "not-matching";
          return "converged";
        },
        { timeout: 60_000, intervals: [500, 1000, 2000] },
      )
      .toBe("converged");

    const [a, b, server] = await Promise.all([
      readViaContext(pageA4, PAGE_PATH),
      readViaContext(pageB4, PAGE_PATH),
      readFromServer(PAGE_PATH, base4),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(server);
    return a;
  }

  test("A's offline edits and a concurrent remote edit merge cleanly once A rejoins", async () => {
    await contextA4.setOffline(true);

    // A non-overlapping offline edit on the seeded page...
    await typeAtStart(pageA4, "Offline edit by A (top)");

    // ...and one on a second page while still offline, proving offline work
    // isn't limited to whatever page happened to be open when the network
    // dropped. Navigating while offline works because page2 was prefetched
    // into local data above; page.goto (not reload) is required for the SW
    // to be able to answer it -- see pwa-offline.test.ts's file header.
    await pageA4.goto(`${base4}/${PAGE2_NAME}`, {
      waitUntil: "domcontentloaded",
    });
    await pageA4
      .locator("#sb-editor .cm-editor")
      .waitFor({ state: "visible", timeout: 30_000 });
    await typeAtEnd(pageA4, "Offline edit by A on page2");
    await pageA4.goto(`${base4}/${PAGE_NAME}`, {
      waitUntil: "domcontentloaded",
    });
    await pageA4
      .locator("#sb-editor .cm-editor")
      .waitFor({ state: "visible", timeout: 30_000 });

    // A remote actor changes a different part of the SAME page on the
    // server while A is offline and can't see it yet.
    const before = await readFromServer(PAGE_PATH, base4);
    await remotePut(
      base4,
      PAGE_PATH,
      `${before}\nRemote edit while A was offline (bottom)`,
    );

    // Rejoin.
    await contextA4.setOffline(false);

    await expect(pageA4.locator("#sb-editor .cm-content")).toContainText(
      "Remote edit while A was offline",
      { timeout: 60_000 },
    );
    await expect(pageB4.locator("#sb-editor .cm-content")).toContainText(
      "Offline edit by A (top)",
      { timeout: 60_000 },
    );

    const content = await expectConverged4(
      (c) =>
        c.includes("Offline edit by A (top)") &&
        c.includes("Remote edit while A was offline"),
    );
    expect(content).not.toContain(CONFLICT_START);

    // The second page's offline edit also made it to the server once A
    // rejoined -- offline work on a page that isn't even the one open at
    // rejoin time converges too.
    await expect
      .poll(() => readFromServer(PAGE2_PATH, base4), {
        timeout: 60_000,
        intervals: [500, 1000, 2000],
      })
      .toContain("Offline edit by A on page2");
  });

  test("an overlapping offline edit produces a real conflict on rejoin", async () => {
    await contextA4.setOffline(true);

    const before = await readFromServer(PAGE_PATH, base4);
    const lines = before.split("\n");
    const targetIndex = lines.indexOf("Line2 original");
    expect(targetIndex).toBeGreaterThanOrEqual(0);

    await replaceLineAtomic(pageA4, targetIndex, "Line2 changed offline by A");

    const remoteLines = [...lines];
    remoteLines[targetIndex] = "Line2 changed by Remote while A offline";
    await remotePut(base4, PAGE_PATH, remoteLines.join("\n"));

    await contextA4.setOffline(false);

    await expect(pageA4.locator(".sb-conflict-widget")).toBeVisible({
      timeout: 60_000,
    });
    await expect(pageB4.locator(".sb-conflict-widget")).toBeVisible({
      timeout: 60_000,
    });

    const content = await expectConverged4((c) => {
      const hunks = c.split(CONFLICT_START).length - 1;
      return hunks === 1;
    });
    expect(content).toContain("Line2 changed offline by A");
    expect(content).toContain("Line2 changed by Remote while A offline");
  });
});

/**
 * Latency, not failure: every /.fs request context A's service worker makes
 * is delayed, while both contexts repeatedly edit different parts of the
 * same page. A slow connection must still converge cleanly -- slow is not
 * the same failure mode as broken, and the merge path shouldn't treat it as
 * one (no scrambling, no lost rounds).
 */
test.describe("Laggy connection: repeated edits still converge cleanly", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Live service worker collaboration sync only runs on Chromium",
  );

  let proc5: ChildProcess;
  let spaceDir5: string;
  let base5: string;
  let contextA5: BrowserContext;
  let contextB5: BrowserContext;
  let pageA5: Page;
  let pageB5: Page;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    spaceDir5 = await mkdtemp(join(tmpdir(), "sb-collab-laggy-e2e-"));
    await writeFile(join(spaceDir5, PAGE_PATH), SEED_CONTENT);

    const port = await getFreePort();
    const opts: SpawnServerOptions = { disableServiceWorker: false };
    proc5 = spawnServerProcess(spaceDir5, port, opts);
    base5 = `http://127.0.0.1:${port}`;
    await waitForServer(`${base5}/.ping`);

    contextA5 = await browser.newContext();
    contextB5 = await browser.newContext();
    pageA5 = await contextA5.newPage();
    pageB5 = await contextB5.newPage();

    // Every /.fs request from A's context -- including the ones its service
    // worker makes to push/pull, not just page-initiated ones -- pays
    // 800-1500ms of latency before being let through.
    await contextA5.route("**/.fs/**", async (route) => {
      await new Promise((resolve) =>
        setTimeout(resolve, 800 + Math.random() * 700),
      );
      await route.continue();
    });

    await openLiveClientPage(pageA5, base5);
    await openLiveClientPage(pageB5, base5);
  });

  test.afterAll(async () => {
    await contextA5?.unroute("**/.fs/**");
    await contextA5?.close();
    await contextB5?.close();
    proc5?.kill("SIGTERM");
    await rm(spaceDir5, { recursive: true, force: true });
  });

  // This test used to reproduce silent data loss: under injected latency,
  // A's own already-*saved* edits were sometimes wholesale overwritten by an
  // incoming pull of B's content -- not merged, not conflicted, just gone.
  // The pull sites in `client/spaces/sync.ts` decided "remote changed, local
  // didn't" from state read early in the cycle and then wrote the remote
  // bytes after a full round trip, without re-checking that local was still
  // what the decision assumed. They now re-check immediately before writing.
  test("4 rounds of concurrent non-overlapping edits all survive and converge byte-identical", async () => {
    const rounds = 4;
    for (let i = 1; i <= rounds; i++) {
      await Promise.all([
        typeAtStart(pageA5, `Laggy-A-round-${i}`),
        typeAtEnd(pageB5, `Laggy-B-round-${i}`),
      ]);
    }

    await expect
      .poll(
        async () => {
          const [a, b, server] = await Promise.all([
            readViaContext(pageA5, PAGE_PATH),
            readViaContext(pageB5, PAGE_PATH),
            readFromServer(PAGE_PATH, base5),
          ]);
          return a === b && b === server ? "converged" : "diverged";
        },
        { timeout: 90_000, intervals: [1000, 2000, 3000] },
      )
      .toBe("converged");

    const [a, b, server] = await Promise.all([
      readViaContext(pageA5, PAGE_PATH),
      readViaContext(pageB5, PAGE_PATH),
      readFromServer(PAGE_PATH, base5),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(server);
    expect(a).not.toContain(CONFLICT_START);

    for (let i = 1; i <= rounds; i++) {
      expect(a).toContain(`Laggy-A-round-${i}`);
      expect(a).toContain(`Laggy-B-round-${i}`);
    }

    // No scrambling: A's live editor buffer matches the converged file
    // exactly, not some interleaved/garbled variant of it.
    const editorTextA = await pageA5.evaluate(
      () => (window as any).client.editorView.state.sliceDoc() as string,
    );
    expect(editorTextA).toBe(a);
  });
});

/**
 * Intermittent failure, not latency and not a clean offline/online
 * transition: individual /.fs requests from A fail outright (as if packets
 * were dropped), and the /.events SSE connection is killed once, while
 * edits keep flowing on both sides. Clearing the faults must let everything
 * catch up to full convergence, and the realtime path specifically must
 * come back healthy -- not just eventually via the periodic backstop.
 */
test.describe("Flaky connection: intermittent failures recover", () => {
  test.describe.configure({ mode: "serial", timeout: 180_000 });
  test.skip(
    ({ browserName }) => browserName !== "chromium",
    "Live service worker collaboration sync only runs on Chromium",
  );

  let proc6: ChildProcess;
  let spaceDir6: string;
  let base6: string;
  let contextA6: BrowserContext;
  let contextB6: BrowserContext;
  let pageA6: Page;
  let pageB6: Page;
  let faultsActive = true;
  let fsRequestCount = 0;
  let eventsKilled = false;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    spaceDir6 = await mkdtemp(join(tmpdir(), "sb-collab-flaky-e2e-"));
    await writeFile(join(spaceDir6, PAGE_PATH), SEED_CONTENT);

    const port = await getFreePort();
    const opts: SpawnServerOptions = { disableServiceWorker: false };
    proc6 = spawnServerProcess(spaceDir6, port, opts);
    base6 = `http://127.0.0.1:${port}`;
    await waitForServer(`${base6}/.ping`);

    contextA6 = await browser.newContext();
    contextB6 = await browser.newContext();
    pageA6 = await contextA6.newPage();
    pageB6 = await contextB6.newPage();

    // Faults are injected only once both contexts are up and fully synced
    // (see the test body) -- registering them here would break the initial
    // bootstrap sync itself, which needs a clean run of /.fs requests to
    // seed local data in the first place.
    await openLiveClientPage(pageA6, base6);
    await openLiveClientPage(pageB6, base6);
  });

  test.afterAll(async () => {
    await contextA6?.unroute("**/.fs/**");
    await contextA6?.unroute("**/.events");
    await contextA6?.close();
    await contextB6?.close();
    proc6?.kill("SIGTERM");
    await rm(spaceDir6, { recursive: true, force: true });
  });

  test("edits made through intermittent failures converge, then realtime recovers", async () => {
    // Every 3rd /.fs request from A fails outright, as long as faults are
    // active -- packet loss, not latency.
    await contextA6.route("**/.fs/**", async (route) => {
      fsRequestCount++;
      if (faultsActive && fsRequestCount % 3 === 0) {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    // The SSE connection dies exactly once, then behaves normally --
    // RealtimeEvents' own reconnect/backoff has to recover it.
    await contextA6.route("**/.events", async (route) => {
      if (!eventsKilled) {
        eventsKilled = true;
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    // Drive edits while the faults are live.
    for (let i = 1; i <= 4; i++) {
      await Promise.all([
        typeAtStart(pageA6, `Flaky-A-round-${i}`),
        typeAtEnd(pageB6, `Flaky-B-round-${i}`),
      ]);
    }

    // Clear the faults: from here on A's connection is clean.
    faultsActive = false;

    // General convergence, generously timed -- this also doubles as "wait
    // for things to settle" before the tighter realtime-recovery check
    // below: it can only pass once at least one clean sync cycle has run,
    // by which point the SSE (needing only its capped 1s-30s backoff) has
    // had ample time to reconnect too.
    await expect
      .poll(
        async () => {
          const [a, b, server] = await Promise.all([
            readViaContext(pageA6, PAGE_PATH),
            readViaContext(pageB6, PAGE_PATH),
            readFromServer(PAGE_PATH, base6),
          ]);
          return a === b && b === server ? "converged" : "diverged";
        },
        { timeout: 90_000, intervals: [1000, 2000, 3000] },
      )
      .toBe("converged");

    const [a, b, server] = await Promise.all([
      readViaContext(pageA6, PAGE_PATH),
      readViaContext(pageB6, PAGE_PATH),
      readFromServer(PAGE_PATH, base6),
    ]);
    expect(a).toBe(b);
    expect(b).toBe(server);
    expect(a).not.toContain(CONFLICT_START);
    for (let i = 1; i <= 4; i++) {
      expect(a).toContain(`Flaky-A-round-${i}`);
      expect(a).toContain(`Flaky-B-round-${i}`);
    }

    // Realtime recovery: a fresh remote edit should now reach A quickly --
    // well under the 20s unhealthy-backstop interval -- proving the SSE
    // path came back, not just that periodic polling eventually caught up.
    await remotePut(base6, PAGE_PATH, `${a}\nRemote edit after recovery`);

    await expect(pageA6.locator("#sb-editor .cm-content")).toContainText(
      "Remote edit after recovery",
      { timeout: 15_000 },
    );
  });
});

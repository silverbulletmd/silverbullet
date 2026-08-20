import { expect } from "@playwright/test";
import type { ChildProcess } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  gotoSilverBulletPage,
  mod,
  redoChord,
  spawnServerProcess,
  test,
  waitForSaveAndReadFromServer,
  waitForServer,
} from "./fixtures.ts";

test.use({
  spaceFiles: {
    "index.md": "Hello world\n",
  },
});

test("external disk edit appears live, preserves cursor, and is undoable", async ({
  sbPage,
  sbServer,
}) => {
  const editor = sbPage.locator(".cm-content");
  await expect(editor).toContainText("Hello world");

  // Place the cursor at the end of "Hello world" (pos 11) and mark the JS
  // context so we can prove no reload happened
  await editor.click();
  await sbPage.evaluate(() => {
    const client = (globalThis as any).client;
    client.editorView.dispatch({ selection: { anchor: 11 } });
    (globalThis as any).__noReloadMarker = true;
  });

  // External program writes the file out-of-band
  await writeFile(
    join(sbServer.spaceDir, "index.md"),
    "Hello world\nExternal line\n",
  );

  // Change appears via the push path (well under the 3s poll cadence)
  await expect(editor).toContainText("External line", { timeout: 2500 });

  // No page reload, cursor unmoved
  const state = await sbPage.evaluate(() => ({
    marker: (globalThis as any).__noReloadMarker === true,
    cursor: (globalThis as any).client.editorView.state.selection.main.head,
  }));
  expect(state.marker).toBe(true);
  expect(state.cursor).toBe(11);

  // Presence artifacts render
  await expect(sbPage.locator(".sb-external-edit").first()).toBeVisible();
  await expect(sbPage.locator(".sb-external-caret")).toHaveAttribute(
    "data-source",
    "external",
  );
  await expect(sbPage.locator(".sb-external-caret-label")).toHaveText(
    "external",
  );

  // Undo reverts the external edit...
  await editor.click();
  await sbPage.keyboard.press(`${mod}+z`);
  await expect(editor).not.toContainText("External line");

  // ...and the revert autosaves back to disk
  await expect
    .poll(() => readFile(join(sbServer.spaceDir, "index.md"), "utf-8"), {
      timeout: 5000,
    })
    .not.toContain("External line");
});

test("undo after moving the cursor past an external edit restores the user's cursor, not the pre-edit position", async ({
  sbPage,
  sbServer,
}) => {
  const editor = sbPage.locator(".cm-content");
  await expect(editor).toContainText("Hello world");

  // Focus the editor once, up front, cursor at 0 (page load, untouched).
  // From here on we never click again -- a click right before undo would
  // itself move the cursor and mask the bug, exactly the trap the first
  // test above falls into (it clicks immediately before pressing undo).
  await editor.click();
  await sbPage.evaluate(() => {
    (globalThis as any).client.editorView.dispatch({
      selection: { anchor: 0 },
    });
  });

  // External program writes the file out-of-band while the cursor is still at 0.
  await writeFile(
    join(sbServer.spaceDir, "index.md"),
    "Hello world\nExternal line\n",
  );
  await expect(editor).toContainText("External line", { timeout: 2500 });

  // *Then* the user moves the cursor -- programmatically, not via another
  // click, to keep this test isolated to undo's own selection handling.
  await sbPage.evaluate(() => {
    (globalThis as any).client.editorView.dispatch({
      selection: { anchor: 6 },
    });
  });
  const beforeUndo = await sbPage.evaluate(
    () => (globalThis as any).client.editorView.state.selection.main.head,
  );
  expect(beforeUndo).toBe(6);

  // Undo without clicking first.
  await sbPage.keyboard.press(`${mod}+z`);
  await expect(editor).not.toContainText("External line");

  const afterUndo = await sbPage.evaluate(
    () => (globalThis as any).client.editorView.state.selection.main.head,
  );
  expect(afterUndo).toBe(6);

  await sbPage.evaluate(() => {
    (globalThis as any).client.editorView.dispatch({
      selection: { anchor: 3 },
    });
  });
  await sbPage.keyboard.press(redoChord);
  await expect(editor).toContainText("External line");
  const afterRedo = await sbPage.evaluate(
    () => (globalThis as any).client.editorView.state.selection.main.head,
  );
  expect(afterRedo).toBe(3);
});

test("external edit merges with unsaved local typing", async ({
  sbPage,
  sbServer,
}) => {
  const editor = sbPage.locator(".cm-content");
  await expect(editor).toContainText("Hello world");

  // Type locally, then have the external program write (against the base) before
  // autosave has necessarily flushed
  await editor.click();
  await sbPage.evaluate(() => {
    (globalThis as any).client.editorView.dispatch({
      changes: { from: 0, insert: "LOCAL " },
    });
  });
  await writeFile(
    join(sbServer.spaceDir, "index.md"),
    "Hello world\nExternal line\n",
  );

  await expect(editor).toContainText("External line", { timeout: 2500 });
  await expect(editor).toContainText("LOCAL Hello world");

  // Merged result reaches disk
  await expect
    .poll(() => readFile(join(sbServer.spaceDir, "index.md"), "utf-8"), {
      timeout: 5000,
    })
    .toContain("LOCAL");
});

test("the client's own save is not treated as an external change", async ({
  page,
  sbServer,
}) => {
  // Not what this test is about: an SSE notification makes the client probe
  // file metadata, and a probe overlapping our own write suppresses that
  // write's event entirely (operationCount guard in EventedSpacePrimitives),
  // making the count below timing-dependent.
  await page.route("**/.events", (route) => route.fulfill({ status: 404 }));
  await gotoSilverBulletPage(page, sbServer);

  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("Hello world");

  await editor.click();
  await page.evaluate(() => {
    const client = (globalThis as any).client;
    (globalThis as any).__reloads = 0;
    (globalThis as any).__ownWriteEvents = 0;
    client.eventHook.addLocalListener(
      "file:changed",
      (name: string, _o: number, _n: number, ownWrite: boolean) => {
        if (name === "index.md" && ownWrite) {
          (globalThis as any).__ownWriteEvents++;
        }
      },
    );
    const cm = client.contentManager;
    const original = cm.reloadPageContent.bind(cm);
    cm.reloadPageContent = (...args: unknown[]) => {
      (globalThis as any).__reloads++;
      return original(...args);
    };
    client.editorView.dispatch({
      selection: { anchor: client.editorView.state.doc.length },
    });
  });

  await page.keyboard.type("typed by me");
  const saved = await waitForSaveAndReadFromServer(page, sbServer, "index.md");
  expect(saved).toBe("Hello world\ntyped by me");
  await page.waitForTimeout(1500);

  // The save was announced, and the announcement said we caused it...
  expect(
    await page.evaluate(() => (globalThis as any).__ownWriteEvents),
  ).toBeGreaterThan(0);
  // ...so it never reached the path that fetches the page back and merges it.
  expect(await page.evaluate(() => (globalThis as any).__reloads)).toBe(0);
  await expect(page.locator(".sb-external-edit")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      (globalThis as any).client.editorView.state.sliceDoc(),
    ),
  ).toBe("Hello world\ntyped by me");
});

test("undo isolates the external edit from the user's own prior typing", async ({
  sbPage,
  sbServer,
}) => {
  const editor = sbPage.locator(".cm-content");
  await expect(editor).toContainText("Hello world");

  await editor.click();
  await writeFile(
    join(sbServer.spaceDir, "index.md"),
    "Hello world\nExternal line\n",
  );
  await sbPage.evaluate(async () => {
    const client = (globalThis as any).client;
    client.editorView.dispatch({
      changes: { from: 12, insert: "LOCAL\n" },
    });
    await client.contentManager.reloadPageContent();
  });

  await expect(editor).toContainText("External line");
  await expect(editor).toContainText("LOCAL");

  // First undo: only the external edit reverts. The user's own prior
  // typing, a separate undo-history entry, must survive untouched -- this
  // is the guarantee the brief calls "undo isolation."
  await editor.click();
  await sbPage.keyboard.press(`${mod}+z`);
  await expect(editor).not.toContainText("External line");
  await expect(editor).toContainText("LOCAL");

  // Second undo: now the user's own typing reverts too, back to the
  // pristine loaded content.
  await sbPage.keyboard.press(`${mod}+z`);
  await expect(editor).not.toContainText("LOCAL");
  await expect(editor).toContainText("Hello world");
});

test("cursor position maps correctly around an external edit landing before it", async ({
  sbPage,
  sbServer,
}) => {
  const editor = sbPage.locator(".cm-content");
  await expect(editor).toContainText("Hello world");

  // "Hello world\n": place the cursor between "wo" and "rld" (offset 8),
  // strictly *before* where the external write below inserts text. This is
  // the failure-prone direction test 1's cursor check can't reach.
  await editor.click();
  await sbPage.evaluate(() => {
    (globalThis as any).client.editorView.dispatch({
      selection: { anchor: 8 },
    });
  });

  // An external write inserts a whole new line *before* "Hello world" -- the cursor's
  // line shifts down by exactly the inserted prefix's length.
  await writeFile(
    join(sbServer.spaceDir, "index.md"),
    "External line\nHello world\n",
  );
  await expect(editor).toContainText("External line", { timeout: 2500 });

  const result = await sbPage.evaluate(() => {
    const view = (globalThis as any).client.editorView;
    const pos = view.state.selection.main.head;
    return {
      pos,
      before: view.state.doc.sliceString(Math.max(0, pos - 8), pos),
      after: view.state.doc.sliceString(pos, pos + 4),
    };
  });

  // A bare numeric assertion here would be satisfied by an off-by-length
  // bug that happens to compute the same coincidental number, so assert on
  // the actual surrounding text as well: the cursor must still sit exactly
  // between "wo" and "rld", now 14 characters ("External line\n") further in.
  expect(result.pos).toBe(22);
  expect(result.before).toBe("Hello wo");
  expect(result.after).toBe("rld\n");
});

test("presence highlight and ghost caret expire after the TTL window", async ({
  sbPage,
  sbServer,
}) => {
  const editor = sbPage.locator(".cm-content");
  await expect(editor).toContainText("Hello world");

  await writeFile(
    join(sbServer.spaceDir, "index.md"),
    "Hello world\nExternal line\n",
  );
  await expect(editor).toContainText("External line", { timeout: 2500 });

  const highlight = sbPage.locator(".sb-external-edit");
  const caret = sbPage.locator(".sb-external-caret");
  await expect(highlight.first()).toBeVisible();
  await expect(caret).toBeVisible();

  // Decorations carry a ~5s TTL. Give the sweep real margin on both sides
  // instead of asserting right at the boundary.
  await expect(highlight).toHaveCount(0, { timeout: 8000 });
  await expect(caret).toHaveCount(0, { timeout: 8000 });
});

test("forced reload applies a pending disk change instead of clobbering the merge base", async ({
  page,
  sbServer,
}) => {
  // Block push entirely so only the explicit reload below can discover the
  // disk change -- isolates loadPage()'s own merge-base handling (the bug
  // Task 5's review found and fixed) from the live SSE/poll path this
  // feature also adds, which would otherwise apply the change first and
  // mask a regression here.
  await page.route("**/.events", (route) => route.fulfill({ status: 404 }));
  await gotoSilverBulletPage(page, sbServer);

  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("Hello world");

  await writeFile(
    join(sbServer.spaceDir, "index.md"),
    "Hello world\nExternal line\n",
  );

  // Sanity check: with push blocked, and well inside the ~3s file-watch
  // poll window, nothing should have applied yet.
  await expect(editor).not.toContainText("External line", { timeout: 500 });

  // The exact method a page-reload command invokes under the hood
  // (ContentManager.reloadEditor -> same-page loadPage()). Previously this
  // set lastKnownDiskText to the freshly-read disk text *before* diffing
  // against it, so the diff -- and the merge -- was always empty even
  // though disk content had actually changed.
  await page.evaluate(() => (globalThis as any).client.reloadEditor());

  await expect(editor).toContainText("External line");
});

test("polling still delivers external edits when /.events is unavailable", async ({
  page,
  sbServer,
}) => {
  let eventsRequestCount = 0;
  await page.route("**/.events", (route) => {
    eventsRequestCount++;
    route.fulfill({ status: 404 });
  });
  const fallbackLogs: string[] = [];
  page.on("console", (msg) => {
    if (msg.text().includes("/.events unavailable")) {
      fallbackLogs.push(msg.text());
    }
  });

  await gotoSilverBulletPage(page, sbServer);
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("Hello world");

  await writeFile(
    join(sbServer.spaceDir, "index.md"),
    "Hello world\nExternal line\n",
  );

  // No push channel available: this can only be the ~3s file-watch poll (or
  // slower), so give it real margin above the push-path threshold used in
  // the tests above.
  await expect(editor).toContainText("External line", { timeout: 6000 });

  // A 404 on the very first attempt is fatal-and-permanent by design (no
  // retry loop hammering the server).
  expect(fallbackLogs.length).toBeGreaterThan(0);
  expect(eventsRequestCount).toBe(1);
});

test("reconnects with backoff after a transient connection failure", async ({
  page,
  sbServer,
}) => {
  let attempts = 0;
  await page.route("**/.events", (route) => {
    attempts++;
    if (attempts === 1) {
      route.abort("connectionrefused");
    } else {
      route.continue();
    }
  });

  await gotoSilverBulletPage(page, sbServer);

  // The first connection attempt fails at the network level (not a fatal
  // HTTP response), so the client's own backoff -- starting at 1s -- retries
  // rather than giving up permanently.
  await expect
    .poll(() => attempts, { timeout: 5000 })
    .toBeGreaterThanOrEqual(2);

  // Prove it's not just a retried request but an actually-working stream:
  // an external edit should still arrive via push, not just the poll
  // fallback.
  const editor = page.locator(".cm-content");
  await expect(editor).toContainText("Hello world");
  await writeFile(
    join(sbServer.spaceDir, "index.md"),
    "Hello world\nExternal line\n",
  );
  await expect(editor).toContainText("External line", { timeout: 2500 });
});

/**
 * Spawns a replacement server on `port`, retrying if it fails to bind.
 * `sbServer.stop()` just killed the previous process holding this exact
 * port; the OS *usually* releases it in time for an immediate rebind
 * (SO_REUSEADDR), but under CI load or a restrictive sandbox that's not
 * guaranteed, so a bind failure here is a plausible flake rather than a
 * real regression. Each attempt gets a bounded wait; a failed attempt is
 * killed and retried after a short backoff.
 */
async function spawnReplacementServer(
  spaceDir: string,
  port: number,
  url: string,
): Promise<ChildProcess> {
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const proc = spawnServerProcess(spaceDir, port);
    try {
      await waitForServer(`${url}/.ping`, 5000);
      return proc;
    } catch (e) {
      lastError = e;
      await new Promise<void>((resolve) => {
        proc.once("exit", () => resolve());
        proc.kill("SIGKILL");
      });
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 300 * attempt));
      }
    }
  }
  throw new Error(
    `Could not (re)bind replacement server to port ${port} after ${maxAttempts} attempts: ${lastError}`,
  );
}

test("reconnect after a genuine server restart refreshes the file list (catch-up)", async ({
  sbPage,
  sbServer,
}) => {
  const editor = sbPage.locator(".cm-content");
  await expect(editor).toContainText("Hello world");

  // Make sure the SSE stream is actually open before we sever it -- this
  // test is specifically about dropping an *established* connection, unlike
  // the transient-failure test above.
  await sbPage.waitForFunction(
    () => (globalThis as any).client?.realtimeEvents?.source?.readyState === 1,
    undefined,
    { timeout: 5000 },
  );

  await sbServer.stop();

  // Written while the server is down, so the only way the client can learn
  // about it is the reconnect catch-up fetch.
  await writeFile(join(sbServer.spaceDir, "NewPage.md"), "# New\n");

  const proc = await spawnReplacementServer(
    sbServer.spaceDir,
    sbServer.port,
    sbServer.url,
  );

  try {
    await sbPage.waitForFunction(
      () =>
        (globalThis as any).client.clientSystem.allKnownFiles.has("NewPage.md"),
      undefined,
      { timeout: 15_000 },
    );
  } finally {
    await new Promise<void>((resolve) => {
      proc.on("exit", () => resolve());
      proc.kill("SIGKILL");
    });
  }
});

test("a conflict landing on the cursor's line still renders the widget, not raw markers", async ({
  sbPage,
  sbServer,
}) => {
  const editor = sbPage.locator(".cm-content");
  await expect(editor).toContainText("Hello world");

  // Cursor on the line that is about to become a conflict hunk.
  await editor.click();
  await sbPage.evaluate(() => {
    (globalThis as any).client.editorView.dispatch({
      selection: { anchor: 5 },
    });
  });

  const h = (c: string) => c.repeat(64);
  await writeFile(
    join(sbServer.spaceDir, "index.md"),
    [
      `<<<<<<< SB sha256:${h("a")}`,
      "Hello world one",
      `||||||| SB BASE sha256:${h("b")}`,
      "Hello world",
      "=======",
      "Hello world two",
      `>>>>>>> SB sha256:${h("c")}`,
      "Trailing line",
      "",
    ].join("\n"),
  );

  // The update replaces the cursor's line with the hunk. The widget must
  // win: the cursor is hopped past the hunk instead of pinning the raw
  // markers open.
  await expect(sbPage.locator(".sb-conflict-widget")).toBeVisible({
    timeout: 5000,
  });
  const cursor = await sbPage.evaluate(
    () => (globalThis as any).client.editorView.state.selection.main.head,
  );
  const hunkEnd = await sbPage.evaluate(() =>
    (globalThis as any).client.editorView.state
      .sliceDoc()
      .indexOf("Trailing line"),
  );
  expect(cursor).toBeGreaterThanOrEqual(hunkEnd);
});

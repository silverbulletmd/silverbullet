import type { Page } from "@playwright/test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

/** Run a Space Lua script in the live in-page runtime (headless mode). */
async function runLua(page: Page, script: string): Promise<unknown> {
  return await page.evaluate(
    (s) => (globalThis as any).sbRuntime.evalLuaScript(s),
    script,
  );
}

/** Invoke system.reboot() via the in-page runtime. Resolves when ready. */
async function reboot(page: Page): Promise<void> {
  await runLua(page, "system.reboot()");
}

/** Run a SLIQ expression and return the resulting array. */
async function query(page: Page, sliq: string): Promise<unknown[]> {
  const result = await runLua(page, `return query[[${sliq}]]`);
  if (result === null || result === undefined) return [];
  if (Array.isArray(result)) return result;
  // An empty Lua table has length 0, so luaValueToJS serializes it as {} not
  // []. Treat any empty plain object as an empty result set.
  if (
    typeof result === "object" &&
    Object.keys(result as object).length === 0
  ) {
    return [];
  }
  return result as unknown[];
}

/** Capture all console messages the page emits (live-updating array). */
function captureConsole(page: Page): {
  messages: { type: string; text: string }[];
} {
  const messages: { type: string; text: string }[] = [];
  page.on("console", (msg) =>
    messages.push({ type: msg.type(), text: msg.text() }),
  );
  return { messages };
}

/** Poll until `predicate()` is true or the timeout elapses. */
async function waitFor(
  predicate: () => boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Condition not met within ${timeoutMs}ms`);
}

test.describe("system.reboot()", () => {
  test.use({ spaceFiles: { "index.md": "# Index\nEntry point.\n" } });

  test("out-of-band create: a new on-disk page is indexed after reboot", async ({
    sbServer,
    page,
  }) => {
    await gotoSilverBulletPage(page, sbServer);

    // The page does not exist yet.
    expect(
      await query(
        page,
        `from index.tag "page" where name == "OutOfBand" select name`,
      ),
    ).toEqual([]);

    // Create a markdown file directly on disk — no editor, no index event.
    await writeFile(
      join(sbServer.spaceDir, "OutOfBand.md"),
      "# Out Of Band\nCreated directly on disk.\n",
    );

    await reboot(page);

    // No sleep: the change must already be indexed.
    expect(
      await query(
        page,
        `from index.tag "page" where name == "OutOfBand" select name`,
      ),
    ).toEqual(["OutOfBand"]);
  });

  test("out-of-band modify: index reflects new on-disk content after reboot", async ({
    sbServer,
    page,
  }) => {
    const notePath = join(sbServer.spaceDir, "Note.md");
    await writeFile(notePath, "# Note\noriginal content\n");
    await gotoSilverBulletPage(page, sbServer);

    // Original is indexed; the new tag is not present yet.
    expect(
      await query(
        page,
        `from index.tag "page" where name == "Note" select name`,
      ),
    ).toEqual(["Note"]);
    expect(
      await query(page, `from index.tag "rebootmodify" select name`),
    ).toEqual([]);

    // Rewrite the file on disk, adding a frontmatter tag.
    await writeFile(
      notePath,
      "---\ntags: rebootmodify\n---\n# Note\nupdated content\n",
    );
    await reboot(page);

    // The page is now tagged from its updated on-disk content.
    expect(
      await query(page, `from index.tag "rebootmodify" select name`),
    ).toEqual(["Note"]);
  });

  test("out-of-band delete: removed file's objects are gone after reboot", async ({
    sbServer,
    page,
  }) => {
    const tempPath = join(sbServer.spaceDir, "Temp.md");
    await writeFile(tempPath, "# Temp\ntemporary page\n");
    await gotoSilverBulletPage(page, sbServer);

    expect(
      await query(
        page,
        `from index.tag "page" where name == "Temp" select name`,
      ),
    ).toEqual(["Temp"]);

    // Remove the file directly on disk.
    await rm(tempPath);
    await reboot(page);

    expect(
      await query(
        page,
        `from index.tag "page" where name == "Temp" select name`,
      ),
    ).toEqual([]);
  });

  test("drain-before-return: query immediately after reboot sees the change (no sleep)", async ({
    sbServer,
    page,
  }) => {
    await gotoSilverBulletPage(page, sbServer);
    await writeFile(join(sbServer.spaceDir, "Racy.md"), "# Racy\nrace check\n");

    // Before reboot the index must NOT yet know about the new file —
    // proving the post-reboot result is caused by reboot, not by the
    // background fetchFileList interval. (Queried well within the 10s
    // interval to keep this deterministic.)
    expect(
      await query(
        page,
        `from index.tag "page" where name == "Racy" select name`,
      ),
    ).toEqual([]);

    await reboot(page);

    // No sleep between reboot resolving and this query: awaitEmptyQueue
    // must have blocked until indexing finished.
    expect(
      await query(
        page,
        `from index.tag "page" where name == "Racy" select name`,
      ),
    ).toEqual(["Racy"]);
  });

  test("script edits applied: a new Library Space Lua function is live after reboot", async ({
    sbServer,
    page,
  }) => {
    await gotoSilverBulletPage(page, sbServer);

    // Function is not defined yet.
    expect(await runLua(page, "return type(myRebootProbe)")).toBe("nil");

    // Add a Library space-lua script directly on disk.
    await mkdir(join(sbServer.spaceDir, "Library"), { recursive: true });
    await writeFile(
      join(sbServer.spaceDir, "Library", "Probe.md"),
      '```space-lua\nfunction myRebootProbe()\n  return "probe-ok"\nend\n```\n',
    );

    await reboot(page);

    // The function is indexed and applied to the live Space Lua env.
    expect(await runLua(page, "return myRebootProbe()")).toBe("probe-ok");
  });

  test("error surfacing: a Lua load error appears in the console after reboot", async ({
    sbServer,
    page,
  }) => {
    const consoleState = captureConsole(page);
    await gotoSilverBulletPage(page, sbServer);

    // Add a Library space-lua script with a syntax error.
    await mkdir(join(sbServer.spaceDir, "Library"), { recursive: true });
    await writeFile(
      join(sbServer.spaceDir, "Library", "Broken.md"),
      "```space-lua\nfunction broken( this is not valid lua\n```\n",
    );

    // reboot itself resolves cleanly — the failure is only in the logs.
    await reboot(page);

    await waitFor(() =>
      consoleState.messages.some(
        (m) =>
          m.type === "error" &&
          /Error (loading|evaluating|reloading) (Lua )?script/i.test(m.text),
      ),
    );
  });

  test("no-op: reboot with nothing changed completes promptly and keeps the index intact", async ({
    sbServer,
    page,
  }) => {
    await gotoSilverBulletPage(page, sbServer);

    const start = Date.now();
    await reboot(page);
    expect(Date.now() - start).toBeLessThan(15_000);

    // The pre-existing index is still intact.
    expect(
      await query(
        page,
        `from index.tag "page" where name == "index" select name`,
      ),
    ).toEqual(["index"]);
  });

  test("in-flight concurrency: reboot converges while file operations are in flight", async ({
    sbServer,
    page,
  }) => {
    await gotoSilverBulletPage(page, sbServer);
    await writeFile(
      join(sbServer.spaceDir, "Concurrent.md"),
      "# Concurrent\nconcurrent check\n",
    );

    // Drive operationCount > 0 (the deferred-fetchFileList path) by firing a
    // burst of concurrent reads, and invoke system.reboot in the same batch.
    await page.evaluate(async () => {
      const client = (globalThis as any).client;
      const esp = client.eventedSpacePrimitives;
      const reads: Promise<unknown>[] = [];
      for (let i = 0; i < 50; i++) {
        reads.push(esp.readFile("index.md").catch(() => {}));
      }
      await Promise.all([
        ...reads,
        client.clientSystem.localSyscall("system.reboot", []),
      ]);
    });

    // No sleep: despite the in-flight reads, the change must be indexed by
    // the time reboot resolved.
    expect(
      await query(
        page,
        `from index.tag "page" where name == "Concurrent" select name`,
      ),
    ).toEqual(["Concurrent"]);
  });
});

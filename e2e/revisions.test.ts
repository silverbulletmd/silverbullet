import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { expect, gotoSilverBulletPage, mod, test } from "./fixtures.ts";
import {
  currentPage,
  navInput,
  openPicker,
  runCommandViaPalette,
} from "./navigator-ui.ts";

const RHS_DOCK = ".sb-nav-root-rhs";

/**
 * Commits whatever is currently on disk under an explicit author/committer,
 * bypassing the managed engine's 30s-debounced auto-commit so revisions are
 * deterministic and don't depend on the engine's timing.
 */
function gitCommit(spaceDir: string, author: string, message: string): void {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: author,
    GIT_AUTHOR_EMAIL: `${author.toLowerCase()}@example.com`,
    GIT_COMMITTER_NAME: author,
    GIT_COMMITTER_EMAIL: `${author.toLowerCase()}@example.com`,
  };
  execFileSync("git", ["add", "-A"], { cwd: spaceDir, env });
  execFileSync(
    "git",
    ["-c", "commit.gpgsign=false", "commit", "-q", "-m", message],
    { cwd: spaceDir, env },
  );
}

function commitCount(spaceDir: string): number {
  const out = execFileSync("git", ["log", "--oneline"], {
    cwd: spaceDir,
  }).toString();
  return out.trim() === "" ? 0 : out.trim().split("\n").length;
}

/**
 * Managed mode (with pre-existing `spaceFiles`, so the server doesn't seed
 * its own default index page into an empty space and race our writes) commits
 * a "SilverBullet"-authored snapshot of the initial content on boot, on a
 * background thread -- wait for it so our own commits land strictly after it,
 * rather than racing to commit the same untouched content ourselves.
 */
async function waitForInitialSnapshot(
  spaceDir: string,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (commitCount(spaceDir) < 1) {
    if (Date.now() > deadline) {
      throw new Error(
        `Managed revisions never committed the initial snapshot in ${spaceDir}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// Neither history view offers phrase filtering, so the input carries no
// placeholder to wait on -- the header label is what identifies the view.
async function openHistoryDock(
  page: Page,
  command: string,
  title: string,
): Promise<Locator> {
  await runCommandViaPalette(page, command);
  const frame = page.locator(RHS_DOCK);
  await expect(frame.locator(".sb-nav-title")).toHaveText(title, {
    timeout: 20_000,
  });
  return frame;
}

function modalPreview(page: Page) {
  return page.locator(".sb-revision-preview");
}

test.describe("Page History lists real revisions", () => {
  test.use({
    serverEnv: { SB_REVISIONS: "managed" },
    spaceFiles: { "index.md": "Version 1\n" },
  });

  test("shows the expected number of rows with the right authors and diff/time chips, newest first", async ({
    page,
    sbServer,
  }) => {
    await waitForInitialSnapshot(sbServer.spaceDir);

    await writeFile(
      join(sbServer.spaceDir, "index.md"),
      "Version 1 updated\nVersion 2\n",
    );
    gitCommit(sbServer.spaceDir, "Alice", "Add line");

    await writeFile(
      join(sbServer.spaceDir, "index.md"),
      "Version 1 updated\nVersion 2\nVersion 3\n",
    );
    gitCommit(sbServer.spaceDir, "Bob", "Add another line");

    await gotoSilverBulletPage(page, sbServer);
    const frame = await openHistoryDock(
      page,
      "Revision: Page History",
      "Page History",
    );

    await expect(frame.locator(".sb-nav-row")).toHaveCount(3);
    const rows = frame.locator(".sb-nav-row");

    await expect(rows.nth(0).locator(".sb-nav-primary")).toHaveText("Bob");
    await expect(rows.nth(1).locator(".sb-nav-primary")).toHaveText("Alice");
    await expect(rows.nth(2).locator(".sb-nav-primary")).toHaveText(
      "SilverBullet",
    );

    const bobChips = rows.nth(0).locator(".sb-nav-chip");
    await expect(bobChips).toHaveCount(2);
    await expect(bobChips.nth(0)).toHaveText("+1 −0");
    // Relative in the row, exact in its tooltip.
    await expect(bobChips.nth(1)).toHaveText(/ago$|^now$/);
    await expect(bobChips.nth(1)).toHaveAttribute(
      "title",
      /^[A-Za-z]{3} \d{1,2}, \d{4} \d{2}:\d{2}$/,
    );

    const aliceChips = rows.nth(1).locator(".sb-nav-chip");
    await expect(aliceChips).toHaveCount(2);
    // "Version 1" -> "Version 1 updated" (1 removed, 1 added) plus a new
    // "Version 2" line (1 added): +2 -1.
    await expect(aliceChips.nth(0)).toHaveText("+2 −1");

    const rootChips = rows.nth(2).locator(".sb-nav-chip");
    // The root commit's diff is against the empty tree: the whole file is new.
    await expect(rootChips.nth(0)).toHaveText("+1 −0");
  });
});

test.describe("Page History preview", () => {
  test.use({
    serverEnv: { SB_REVISIONS: "managed" },
    spaceFiles: { "index.md": "Version 1\n" },
  });

  test("shows a diff by default, toggles to content and back, and Escape closes", async ({
    page,
    sbServer,
  }) => {
    await waitForInitialSnapshot(sbServer.spaceDir);

    await writeFile(
      join(sbServer.spaceDir, "index.md"),
      "Version 1 updated\nVersion 2\n",
    );
    gitCommit(sbServer.spaceDir, "Bob", "Add line");

    await gotoSilverBulletPage(page, sbServer);
    const frame = await openHistoryDock(
      page,
      "Revision: Page History",
      "Page History",
    );

    await frame.locator(".sb-nav-row", { hasText: "Bob" }).click();

    await expect(page.locator(".sb-modal-backdrop")).toBeVisible();
    const preview = modalPreview(page);

    // `.sb-modal` paints no background and sets no height of its own -- every
    // other user of it holds an iframe or a nav panel that does. Without these
    // the page shows through the preview and its footer falls off-screen, and
    // every other assertion in this file still passes.
    await expect(preview).not.toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    const box = (await preview.boundingBox())!;
    const viewport = page.viewportSize()!;
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);

    // The header's control stays on one row: `.sb-segments-wrap` sets
    // `min-width: 0`, so a title that refuses to shrink pushes it to wrap.
    const segTops = await preview
      .locator(".sb-segment")
      .evaluateAll((els) =>
        els.map((e) => Math.round(e.getBoundingClientRect().top)),
      );
    expect(new Set(segTops).size).toBe(1);

    // Footer buttons: right-aligned, in order, not overlapping.
    const closeBox = (await preview
      .getByRole("button", { name: "Close" })
      .boundingBox())!;
    const restoreBox = (await preview
      .getByRole("button", { name: "Restore" })
      .boundingBox())!;
    expect(closeBox.x + closeBox.width).toBeLessThanOrEqual(restoreBox.x);
    expect(restoreBox.x + restoreBox.width).toBeGreaterThan(
      box.x + box.width - 40,
    );
    await expect(
      preview.locator(".sb-revision-diff-hunk").first(),
    ).toBeVisible();
    await expect(
      preview.locator(".sb-revision-diff-add").first(),
    ).toBeVisible();
    await expect(
      preview.locator(".sb-revision-diff-del").first(),
    ).toBeVisible();
    await expect(preview.getByRole("radio", { name: "Diff" })).toHaveClass(
      /sb-segment-active/,
    );

    await preview.getByRole("radio", { name: "Content" }).click();
    await expect(preview.getByRole("radio", { name: "Content" })).toHaveClass(
      /sb-segment-active/,
    );
    await expect(preview.locator(".sb-revision-preview-body")).toContainText(
      "Version 1 updated",
    );
    await expect(preview.locator(".sb-revision-preview-body")).toContainText(
      "Version 2",
    );
    await expect(
      preview.locator(".sb-revision-preview-body .sb-revision-diff-add"),
    ).toHaveCount(0);

    await preview.getByRole("radio", { name: "Diff" }).click();
    await expect(preview.getByRole("radio", { name: "Diff" })).toHaveClass(
      /sb-segment-active/,
    );
    await expect(
      preview.locator(".sb-revision-diff-add").first(),
    ).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(page.locator(".sb-modal-backdrop")).toBeHidden();
    // The RHS dock is untouched by closing the modal preview, and takes the
    // focus back so the keyboard still drives it.
    await expect(page.locator(RHS_DOCK)).toBeVisible();
    await expect(page.locator(`${RHS_DOCK} input.sb-nav-input`)).toBeFocused();
  });

  test("restores the previewed revision and closes", async ({
    page,
    sbServer,
  }) => {
    await waitForInitialSnapshot(sbServer.spaceDir);

    await writeFile(
      join(sbServer.spaceDir, "index.md"),
      "Version 1 updated\nVersion 2\n",
    );
    gitCommit(sbServer.spaceDir, "Bob", "Add line");

    await gotoSilverBulletPage(page, sbServer);
    const editorContent = () =>
      page.evaluate(() =>
        (globalThis as any).client.editorView.state.doc.toString(),
      );
    const frame = await openHistoryDock(
      page,
      "Revision: Page History",
      "Page History",
    );

    // Preview the baseline (pre-Bob) revision, then restore it from the modal.
    await frame.locator(".sb-nav-row", { hasText: "SilverBullet" }).click();
    await expect(page.locator(".sb-modal-backdrop")).toBeVisible();
    await modalPreview(page).getByRole("button", { name: "Restore" }).click();

    await expect(page.locator(".sb-modal-backdrop")).toBeHidden();
    await expect(async () => {
      expect(await editorContent()).toBe("Version 1\n");
    }).toPass({ timeout: 5_000 });
  });
});

test.describe("Page History restore", () => {
  test.use({
    serverEnv: { SB_REVISIONS: "managed" },
    spaceFiles: { "index.md": "Version 1\n" },
  });

  test("restoring an older revision is a single undo step", async ({
    page,
    sbServer,
  }) => {
    await waitForInitialSnapshot(sbServer.spaceDir);

    await writeFile(
      join(sbServer.spaceDir, "index.md"),
      "Version 1 updated\nVersion 2\n",
    );
    gitCommit(sbServer.spaceDir, "Bob", "Add line");

    await gotoSilverBulletPage(page, sbServer);
    const editorContent = () =>
      page.evaluate(() =>
        (globalThis as any).client.editorView.state.doc.toString(),
      );

    await expect(page.locator("#sb-editor .cm-content")).toContainText(
      "Version 2",
    );
    expect(await editorContent()).toBe("Version 1 updated\nVersion 2\n");

    const frame = await openHistoryDock(
      page,
      "Revision: Page History",
      "Page History",
    );
    // Restore the automatic baseline revision -- the original, pre-Bob text.
    const baselineRow = frame.locator(".sb-nav-row", {
      hasText: "SilverBullet",
    });
    await baselineRow.hover();
    await baselineRow.locator('.sb-row-action[aria-label="Restore"]').click();

    await expect(page.locator("#sb-editor .cm-content")).not.toContainText(
      "Version 2",
      { timeout: 5_000 },
    );
    expect(await editorContent()).toBe("Version 1\n");

    // A single undo step returns to Bob's (newer) text, not to some
    // intermediate state -- the restore must be one atomic transaction.
    await page.locator("#sb-editor .cm-content").click();
    await page.keyboard.press(`${mod}+z`);
    await expect(async () => {
      expect(await editorContent()).toBe("Version 1 updated\nVersion 2\n");
    }).toPass();
  });
});

test.describe("Space History", () => {
  test.use({
    serverEnv: { SB_REVISIONS: "managed" },
    spaceFiles: {
      "index.md": "Index\n",
      "page-a.md": "A1\n",
      "page-b.md": "B1\n",
    },
  });

  test("expands a commit on click, and previews the pages it touched", async ({
    page,
    sbServer,
  }) => {
    await waitForInitialSnapshot(sbServer.spaceDir);

    await writeFile(join(sbServer.spaceDir, "page-a.md"), "A1 updated\n");
    gitCommit(sbServer.spaceDir, "Bob", "Update A");
    // Uncommitted on top, so restoring Bob's revision is a real change rather
    // than rewriting the file with what it already says (the 30s auto-commit
    // debounce cannot fire within this test).
    await writeFile(join(sbServer.spaceDir, "page-a.md"), "A1 latest\n");

    await gotoSilverBulletPage(page, sbServer);
    const frame = await openHistoryDock(
      page,
      "Revision: Space History",
      "Space History",
    );

    // Collapsed by default: the uncommitted entry plus the two commits, no
    // children showing under any of them.
    await expect(frame.locator(".sb-nav-row")).toHaveCount(3);
    const bobRow = frame.locator(".sb-nav-row", { hasText: "Bob" });
    await expect(bobRow.locator(".sb-nav-primary")).toHaveText("Bob");
    await expect(bobRow.locator(".sb-nav-chip").first()).toBeVisible();

    // Selecting the commit itself opens it up. Bob's touched only page-a.md.
    await bobRow.click();
    await expect(frame.locator(".sb-nav-row")).toHaveCount(4);
    const fileRow = frame.locator(".sb-nav-row", { hasText: "page-a.md" });
    await expect(fileRow.locator(".sb-nav-primary")).toHaveText("page-a.md");
    // Clicking it again keeps it open rather than toggling it shut.
    await bobRow.click();
    await expect(frame.locator(".sb-nav-row")).toHaveCount(4);

    // A page row previews it, exactly like a Page History row does.
    await fileRow.click();
    await expect(page.locator(".sb-modal-backdrop")).toBeVisible();
    const preview = modalPreview(page);
    await expect(preview.locator(".sb-revision-preview-body")).toContainText(
      "A1 updated",
    );
    await expect(
      preview.getByRole("button", { name: "Restore" }),
    ).toBeVisible();

    // Restoring from here opens the page first -- the editor was on `index`.
    await preview.getByRole("button", { name: "Restore" }).click();
    await expect(page.locator(".sb-modal-backdrop")).toBeHidden();
    await expect(currentPage(page)).toHaveValue("page-a");
    await expect(async () => {
      expect(
        await page.evaluate(() =>
          (globalThis as any).client.editorView.state.doc.toString(),
        ),
      ).toBe("A1 updated\n");
    }).toPass({ timeout: 5_000 });
    // The dock stays open behind it, like any other RHS dock.
    await expect(page.locator(RHS_DOCK)).toBeVisible();
  });
});

test.describe("Uncommitted changes", () => {
  test.use({
    serverEnv: { SB_REVISIONS: "managed" },
    spaceFiles: { "index.md": "Version 1\n", "page-a.md": "A1\n" },
  });

  test("heads the space log, expands to the files, and previews the change", async ({
    page,
    sbServer,
  }) => {
    await waitForInitialSnapshot(sbServer.spaceDir);
    // Uncommitted: the 30s auto-commit debounce cannot fire within this test.
    await writeFile(join(sbServer.spaceDir, "page-a.md"), "A1 changed\n");

    await gotoSilverBulletPage(page, sbServer);
    const frame = await openHistoryDock(
      page,
      "Revision: Space History",
      "Space History",
    );

    const uncommitted = frame.locator(".sb-nav-row", {
      hasText: "Uncommitted changes",
    });
    // Ahead of the baseline commit, and carrying no diff/time chips.
    await expect(frame.locator(".sb-nav-row").first()).toContainText(
      "Uncommitted changes",
    );
    await expect(uncommitted.locator(".sb-nav-chip")).toHaveCount(0);

    await uncommitted.click();
    const fileRow = frame.locator(".sb-nav-row", { hasText: "page-a.md" });
    await expect(fileRow).toBeVisible();

    await fileRow.click();
    await expect(page.locator(".sb-modal-backdrop")).toBeVisible();
    const preview = modalPreview(page);
    await expect(
      preview.locator(".sb-revision-diff-add").first(),
    ).toContainText("+A1 changed");
    // Nothing to restore: this is what is already on disk.
    await expect(preview.getByRole("button", { name: "Restore" })).toHaveCount(
      0,
    );
  });
});

test.describe("Revision: Create snapshot", () => {
  test.use({
    serverEnv: { SB_REVISIONS: "managed" },
    spaceFiles: { "index.md": "Version 1\n" },
  });

  test("commits an edit right away instead of waiting for the debounce", async ({
    page,
    sbServer,
  }) => {
    await waitForInitialSnapshot(sbServer.spaceDir);
    const before = commitCount(sbServer.spaceDir);

    await gotoSilverBulletPage(page, sbServer);
    const editorContent = page.locator("#sb-editor .cm-content");
    await editorContent.click();
    await page.keyboard.type("Edited in the editor");
    await page
      .locator("#sb-current-page.sb-saved")
      .waitFor({ state: "attached", timeout: 10_000 });

    // The auto-commit debounce is 30s, so nothing has committed yet.
    expect(commitCount(sbServer.spaceDir)).toBe(before);

    await runCommandViaPalette(page, "Revision: Create snapshot");

    await expect(async () => {
      expect(commitCount(sbServer.spaceDir)).toBe(before + 1);
    }).toPass({ timeout: 10_000 });
    const log = execFileSync("git", ["log", "-1", "--format=%an"], {
      cwd: sbServer.spaceDir,
    })
      .toString()
      .trim();
    expect(log).toBe("SilverBullet");
  });
});

test.describe("Commands hidden when revisions are disabled", () => {
  test.use({
    serverEnv: { SB_REVISIONS: "disabled" },
    spaceFiles: { "index.md": "Hello\n" },
  });

  test("neither history command appears in the palette, and /.revisions/ 404s", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer);

    const frame = await openPicker(page, `${mod}+/`, "Command");
    await navInput(page).fill("Page History");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(0);

    await navInput(page).fill("Space History");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(0);

    await navInput(page).fill("Create snapshot");
    await expect(frame.locator(".sb-nav-row")).toHaveCount(0);
    await page.keyboard.press("Escape");

    const resp = await page.request.get(`${sbServer.url}/.revisions/`);
    expect(resp.status()).toBe(404);
    const body = await resp.json();
    expect(body.error).toBe("revisions disabled");
  });
});

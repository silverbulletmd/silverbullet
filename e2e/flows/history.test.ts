import { execFileSync } from "node:child_process";
import { runCommandViaPalette } from "../fixtures/actions.ts";
import {
  expect,
  gotoSilverBulletPage,
  mod,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

test.use({
  serverEnv: { SB_REVISIONS: "managed" },
  spaceFiles: { "index.md": "First version.\n" },
});

test("an editor snapshots a change, previews history and restores a saved revision", async ({
  page,
  sbServer,
}) => {
  const head = () => {
    try {
      return execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: sbServer.spaceDir,
        stdio: "pipe",
        encoding: "utf8",
      }).trim();
    } catch {
      return "";
    }
  };
  await expect.poll(head).not.toBe("");
  const initial = head();
  await gotoSilverBulletPage(page, sbServer);
  await page.locator(".cm-content").click();
  await page.keyboard.press(`${mod}+a`);
  await page.keyboard.insertText("Second version.\n");
  await waitForPersistedContent(sbServer, "index.md", "Second version.\n");
  await runCommandViaPalette(page, "Revision: Create snapshot");
  await expect.poll(head).not.toBe(initial);
  await runCommandViaPalette(page, "Revision: Page History");
  const history = page.locator(".sb-nav-root-rhs");
  await expect(history.locator(".sb-nav-title")).toHaveText("Page History");
  await expect(history.locator(".sb-nav-row")).toHaveCount(2);
  await history.getByRole("button", { name: /Change placement/ }).click();
  await history.getByRole("menuitem", { name: "Modal window" }).click();
  const modalHistory = page.locator('.sb-nav-root[data-slot="modal"]');
  await expect(modalHistory.locator(".sb-nav-title")).toHaveText(
    "Page History",
  );
  await modalHistory.locator(".sb-nav-row").last().click();
  const preview = page.locator(".sb-revision-preview");
  await expect(preview).toContainText("First version.");
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(modalHistory).toBeVisible();
  await modalHistory.locator(".sb-nav-row").last().click();
  await preview.getByRole("button", { name: "Restore", exact: true }).click();
  await expect(preview).toBeHidden();
  await waitForPersistedContent(sbServer, "index.md", "First version.\n");
  await gotoSilverBulletPage(page, sbServer);
  await expect(page.locator(".cm-content")).toHaveText("First version.");
});

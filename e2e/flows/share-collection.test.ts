import type { ChildProcess } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Page } from "@playwright/test";
import { runCommandViaPalette } from "../fixtures/actions.ts";
import {
  expect,
  getFreePort,
  gotoSilverBulletPage,
  spawnServerProcess,
  test,
  waitForServer,
} from "../fixtures/core.ts";

const USER = "river";
const PASSWORD = "harbor-password";

test.skip(
  !!process.env.SB_E2E_HOST,
  "Signing in to the target space uses the device flow, which needs loopback.",
);

async function startTarget() {
  const dir = await mkdtemp(join(tmpdir(), "sb-e2e-target-"));
  const port = await getFreePort();
  const proc: ChildProcess = spawnServerProcess(dir, port, {
    env: { SB_USER: `${USER}:${PASSWORD}` },
  });
  const url = `http://127.0.0.1:${port}`;
  await waitForServer(`${url}/.ping`);
  return {
    url,
    dir,
    async stop() {
      if (proc.exitCode === null && proc.signalCode === null) {
        const exited = new Promise((resolve) => proc.once("exit", resolve));
        proc.kill("SIGTERM");
        await exited;
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}

async function writeSpaceFile(dir: string, path: string, content: string) {
  await mkdir(dirname(join(dir, path)), { recursive: true });
  await writeFile(join(dir, path), content);
}

function lua(page: Page, expression: string) {
  return page.evaluate(
    (expr) =>
      (globalThis as any).client.clientSystem.localSyscall(
        "lua.evalExpression",
        [expr],
      ),
    expression,
  );
}

/** Share: Collection, picking `name`; the command waits on the dialogs that follow. */
async function publish(page: Page, name: string) {
  await runCommandViaPalette(page, "Share: Collection");
  const picker = page
    .getByRole("dialog")
    .filter({ hasText: "Collection" })
    .getByRole("textbox");
  await expect(picker).toBeFocused();
  await picker.fill(name);
  await picker.press("Enter");
}

test("a collection publishes to another SilverBullet space, and removes a page that left it", async ({
  sbServer,
  page,
  context,
}) => {
  const target = await startTarget();
  try {
    const source = sbServer.spaceDir;
    await writeSpaceFile(
      source,
      "CONFIG.md",
      [
        "```space-lua",
        `config.set("share.silverbullet.spaces", {"${target.url}"})`,
        `config.set("share.collections", {`,
        "  blog = {",
        `    uri = "${target.url}/Blog",`,
        `    pages = function() return index.contentPages("pub") end,`,
        `    path = function(p) return (p.name:gsub("^Blog/", "")) end,`,
        "  },",
        "})",
        "```",
        "",
      ].join("\n"),
    );
    await writeSpaceFile(
      source,
      "Blog/A.md",
      "---\ntags: pub\n---\nSee [[Blog/B]] and [[Private]].\n",
    );
    await writeSpaceFile(
      source,
      "Blog/B.md",
      "---\ntags: pub\n---\nBack to [[Blog/A|A]].\n",
    );
    await writeSpaceFile(source, "Private.md", "Not for publishing.\n");
    await gotoSilverBulletPage(page, sbServer);
    await expect
      .poll(() => lua(page, "#share.collection('blog').members"), {
        timeout: 20_000,
      })
      .toBe(2);

    // The first publish signs in to the target with a device code
    await publish(page, "blog");
    await page.getByRole("button", { name: /^Ok/ }).click();
    const popupPromise = context.waitForEvent("page");
    await page.getByRole("link", { name: "Open" }).click();
    const approval = await popupPromise;
    await approval.locator("#username").fill(USER);
    await approval.locator("#password").fill(PASSWORD);
    await approval.getByRole("button", { name: "Log in" }).click();
    await approval
      .getByRole("button", { name: "Approve", exact: true })
      .click();
    await expect(approval.locator("body")).toContainText("Decision saved");
    await approval.close();

    await expect(page.getByText("Published blog: 2 written")).toBeVisible({
      timeout: 20_000,
    });
    // Links between members stay wiki links in the target space; others become text
    expect(await readFile(join(target.dir, "Blog/A.md"), "utf8")).toBe(
      "---\ntags: pub\n---\nSee [[Blog/B]] and Private.\n",
    );
    expect(await readFile(join(target.dir, "Blog/B.md"), "utf8")).toBe(
      "---\ntags: pub\n---\nBack to [[Blog/A|A]].\n",
    );
    await expect(access(join(target.dir, "Private.md"))).rejects.toThrow();

    // Check reads the target and finds both members up to date
    await runCommandViaPalette(page, "Navigate: Shared Pages");
    const blogRow = page.getByRole("treeitem", { name: /^▾ blog\b/ });
    await blogRow.getByText("blog", { exact: true }).hover();
    // Its members have no Check of their own
    await blogRow.getByRole("button", { name: "Check" }).first().click();
    await expect(page.getByText("up to date")).toHaveCount(2);

    // B leaves the collection: the next publish offers its file for removal
    await page.evaluate(() =>
      (globalThis as any).client.clientSystem.localSyscall("space.writePage", [
        "Blog/B",
        "Back to [[Blog/A|A]].\n",
      ]),
    );
    await expect
      .poll(() => lua(page, "#share.collection('blog').members"), {
        timeout: 20_000,
      })
      .toBe(1);
    await publish(page, "blog");
    await expect(
      page.getByText("These files are no longer in the collection."),
    ).toBeVisible();
    await page.getByRole("checkbox", { name: "B" }).check();
    await page.getByRole("button", { name: "Remove" }).click();
    await expect(page.getByText(/Published blog: .*1 removed/)).toBeVisible();
    await expect(access(join(target.dir, "Blog/B.md"))).rejects.toThrow();
    expect(await readFile(join(target.dir, "Blog/A.md"), "utf8")).toBe(
      "---\ntags: pub\n---\nSee Blog/B and Private.\n",
    );
  } finally {
    await target.stop();
  }
});

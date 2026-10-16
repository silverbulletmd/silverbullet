import { runCommandViaPalette } from "../fixtures/actions.ts";
import { expect, gotoSilverBulletPage, test } from "../fixtures/core.ts";

test.use({ spaceFiles: { "index.md": "Welcome" } });

test("workbench console evaluates Lua with persistent locals and shows errors", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "index");
  await runCommandViaPalette(page, "Workbench: Toggle");
  // Every tab is an `.sb-workbench`; the console is the first
  const workbench = page.locator(".sb-workbench").first();
  await expect(workbench).toBeVisible();
  const log = workbench.locator(".sb-workbench-body");

  // Escape closes any completion popup so Enter runs the input instead of
  // accepting a completion.
  async function run(code: string) {
    await page.keyboard.type(code);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Enter");
  }

  await workbench.locator(".cm-content").click();
  await run("local n = 21");
  await run("n * 2");
  await expect(log).toContainText("42");

  await run("nil_thing.x");
  await expect(log).toContainText("console#3");

  // "Workbench: Scripts" switches the open panel to its Scripts tab and
  // focuses it; switching back keeps the console
  await runCommandViaPalette(page, "Workbench: Scripts");
  const scripts = page.getByRole("table", { name: "Scripts" });
  await expect(scripts).toContainText("Library/Std/Config");
  await expect(
    page.getByRole("searchbox", { name: "Filter scripts" }),
  ).toBeFocused();
  await page.getByRole("radio", { name: "Console" }).click();
  await expect(log).toContainText("console#3");
  await workbench.locator(".cm-content").click();

  // App shortcuts still work with focus in the REPL, and closing returns focus to the page
  await page.keyboard.press("ControlOrMeta+Alt+j");
  await expect(workbench).toBeHidden();
  await expect(page.locator("#sb-editor .cm-content")).toBeFocused();
});

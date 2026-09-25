import { runCommandViaPalette } from "../fixtures/actions.ts";
import {
  expect,
  gotoSilverBulletPage,
  mod,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

test.describe("page links and lifecycle", () => {
  test.use({
    spaceFiles: {
      "Source.md": "Read [[Reference]] and continue with [[Draft Target]].\n",
      "Reference.md":
        '---\npageDecoration:\n  icon: \'<svg viewBox="0 0 24 24" onload="globalThis.__unsafeIconLoaded = true"><script>globalThis.__unsafeIconScript = true</script><circle cx="12" cy="12" r="4"></circle></svg>\'\n---\n# Reference\n\nA useful reference.\n',
    },
  });

  test("following a wiki link opens the referenced page", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Source");
    const referenceLink = page
      .locator(".sb-wiki-link", { hasText: "Reference" })
      .first();
    await expect(
      referenceLink.locator(".sb-page-decoration-icon svg"),
    ).toBeVisible();
    await referenceLink.click();

    await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Reference",
    );
    await expect(page.locator("#sb-editor .cm-content")).toContainText(
      "A useful reference.",
    );
    await expect(
      page.locator(".sb-page-prefix .sb-page-decoration-icon svg"),
    ).toBeVisible();
    await expect(
      page.locator(
        ".sb-page-decoration-icon [onload], .sb-page-decoration-icon script",
      ),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        onload: (globalThis as any).__unsafeIconLoaded,
        script: (globalThis as any).__unsafeIconScript,
      })),
    ).toEqual({ onload: undefined, script: undefined });
  });

  test("a decorated page completion keeps its icon beside its label", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Source");
    await page.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      const cursor = view.state.doc.toString().indexOf("[[Reference") + 2;
      view.dispatch({ selection: { anchor: cursor } });
      view.focus();
    });
    await page.keyboard.press("Control+Space");

    const option = page.locator(".cm-tooltip-autocomplete li", {
      hasText: "Reference",
    });
    const icon = option.locator(".sb-page-decoration-icon");
    const label = option.locator(".cm-completionLabel");
    await expect(icon).toBeVisible();
    await expect(label).toBeVisible();

    const [iconBox, labelBox] = await Promise.all([
      icon.boundingBox(),
      label.boundingBox(),
    ]);
    expect(iconBox).not.toBeNull();
    expect(labelBox).not.toBeNull();
    expect(iconBox!.y).toBeLessThan(labelBox!.y + labelBox!.height);
    expect(labelBox!.y).toBeLessThan(iconBox!.y + iconBox!.height);
  });

  test("an aspiring link creates a page that can be saved and renamed", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Source");
    const missing = page.locator(".sb-wiki-link-missing", {
      hasText: "Draft Target",
    });
    await expect(missing).toBeVisible();
    await missing.click();
    await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
      "Draft Target",
    );

    const editor = page.locator("#sb-editor .cm-content");
    await page.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      view.dispatch({ selection: { anchor: view.state.doc.length } });
      view.focus();
    });
    await page.keyboard.insertText("The page now has durable content.");
    await waitForPersistedContent(
      sbServer,
      "Draft Target.md",
      "The page now has durable content.",
    );

    const pageName = page.locator("#sb-current-page input.sb-input");
    await pageName.click();
    await page.keyboard.press(`${mod}+a`);
    await page.keyboard.insertText("Published Target");
    await page.keyboard.press("Enter");

    await waitForPersistedContent(
      sbServer,
      "Published Target.md",
      "The page now has durable content.",
    );
    await expect
      .poll(async () =>
        (
          await page.request.get(`${sbServer.url}/.fs/Draft%20Target.md`)
        ).status(),
      )
      .toBe(404);
    await gotoSilverBulletPage(page, sbServer, "Published Target");
    await expect(editor).toContainText("The page now has durable content.");
  });

  test("prompt and confirmation dialogs clear the top bar on a narrow screen", async ({
    page,
    sbServer,
  }) => {
    await page.setViewportSize({ width: 596, height: 961 });
    await gotoSilverBulletPage(page, sbServer, "Source");

    const topBarBottom = await page
      .locator("#sb-top")
      .evaluate((element) => element.getBoundingClientRect().bottom);

    await runCommandViaPalette(page, "Page: Copy");
    const prompt = page.locator("dialog.sb-modal-box");
    await expect(prompt).toBeVisible();
    const promptTop = await prompt.evaluate(
      (element) => element.getBoundingClientRect().top,
    );
    expect(promptTop).toBeGreaterThanOrEqual(topBarBottom);
    await prompt.getByRole("button", { name: /Cancel/ }).click();

    await runCommandViaPalette(page, "Page: Delete");
    const confirmation = page.locator("dialog.sb-modal-box");
    await expect(confirmation).toBeVisible();
    const confirmationTop = await confirmation.evaluate(
      (element) => element.getBoundingClientRect().top,
    );
    expect(confirmationTop).toBeGreaterThanOrEqual(topBarBottom);
    await confirmation.getByRole("button", { name: /Cancel/ }).click();
  });
});

import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

test.use({
  spaceFiles: {
    "index.md": "Welcome",
    "Config/Deploy Settings.md": "---\ntags: meta\n---\n\nA meta page.",
    // A non-meta page whose name shares the last segment, so a completion that
    // shortened the caret link would land on the wrong page.
    "Deploy Settings.md": "An ordinary page.",
    "Draft.md": "Reference: [[^Deploy\n",
  },
});

test("caret completion inserts a full-path caret link", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Draft");

  await page.evaluate(async () => {
    const client = (globalThis as any).client;
    const view = client.editorView;
    const text = view.state.doc.toString();
    view.dispatch({ selection: { anchor: text.indexOf("[[^Deploy") + 9 } });
    view.focus();
    await client.clientSystem.localSyscall("editor.startCompletion", []);
  });

  const option = page.locator(".cm-tooltip-autocomplete li", {
    hasText: "Config/Deploy Settings",
  });
  await expect(option).toBeVisible();
  await option.click();

  const source = await page.evaluate(() =>
    (globalThis as any).client.editorView.state.doc.toString(),
  );
  // The caret survives, and the path is written in full: shortening it to
  // `[[^Deploy Settings]]` would address the ordinary page instead.
  expect(source).toContain("[[^Config/Deploy Settings");
});

test("caret completion offers only meta pages", async ({ page, sbServer }) => {
  await gotoSilverBulletPage(page, sbServer, "Draft");

  await page.evaluate(async () => {
    const client = (globalThis as any).client;
    const view = client.editorView;
    const text = view.state.doc.toString();
    view.dispatch({ selection: { anchor: text.indexOf("[[^Deploy") + 9 } });
    view.focus();
    await client.clientSystem.localSyscall("editor.startCompletion", []);
  });

  await expect(
    page.locator(".cm-tooltip-autocomplete li", {
      hasText: "Config/Deploy Settings",
    }),
  ).toBeVisible();
  // The ordinary page of the same name must not be offered here.
  await expect(
    page.locator(".cm-tooltip-autocomplete li").filter({
      hasText: /^Deploy Settings$/,
    }),
  ).toHaveCount(0);
});

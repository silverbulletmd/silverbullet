import type { Page } from "@playwright/test";
import { createPageViaPagePicker } from "../fixtures/actions.ts";
import {
  expect,
  gotoSilverBulletPage,
  mod,
  shiftChord,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

async function selectText(page: Page, text: string): Promise<void> {
  await page.evaluate((needle) => {
    const view = (globalThis as any).client.editorView;
    const start = view.state.doc.toString().indexOf(needle);
    if (start < 0) throw new Error(`Could not find ${needle}`);
    view.dispatch({
      selection: { anchor: start, head: start + needle.length },
    });
    view.focus();
  }, text);
}

async function editorText(page: Page): Promise<string> {
  return page.evaluate(() =>
    (globalThis as any).client.editorView.state.doc.toString(),
  );
}

test("a fresh space can be edited, saved and reopened", async ({
  sbPage,
  sbServer,
}) => {
  const editor = sbPage.locator("#sb-editor .cm-content");
  await expect(editor).toBeVisible();
  await expect(editor).toContainText(
    "Welcome to the wondrous world of SilverBullet",
  );

  await createPageViaPagePicker(sbPage, "First Note");
  await sbPage.locator("#sb-editor .cm-content").click();
  await sbPage.keyboard.insertText("A durable first note.");
  await waitForPersistedContent(
    sbServer,
    "First Note.md",
    "A durable first note.",
  );

  await gotoSilverBulletPage(sbPage, sbServer, "First Note");
  await expect(editor).toContainText("A durable first note.");
});

test.describe("formatting and search", () => {
  test.use({
    spaceFiles: {
      "Formatting.md": "bold phrase\nitalic phrase\nFirst item\nSecond item\n",
      "Search.md": "red apple\nred apple pie\nblueberry\n",
    },
  });

  test("common formatting shortcuts persist markdown", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Formatting");

    await selectText(page, "bold phrase");
    await page.keyboard.press(`${mod}+b`);
    await expect.poll(() => editorText(page)).toContain("**bold phrase**");
    await selectText(page, "italic phrase");
    await page.keyboard.press(`${mod}+i`);
    await expect.poll(() => editorText(page)).toContain("_italic phrase_");
    await selectText(page, "First item\nSecond item");
    await page.keyboard.press(shiftChord("8"));

    await waitForPersistedContent(
      sbServer,
      "Formatting.md",
      "**bold phrase**\n_italic phrase_\n* First item\n* Second item\n",
    );
  });

  test("the editor search panel replaces all matches and saves", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Search");
    await page.locator("#sb-editor .cm-content").click();
    await page.keyboard.press(`${mod}+f`);

    const panel = page.locator(".cm-panel.cm-search");
    await panel.locator('input[name="search"]').fill("red apple");
    await panel.locator('input[name="replace"]').fill("green pear");
    await panel.locator('button[name="replaceAll"]').click();

    await expect
      .poll(() => editorText(page))
      .toBe("green pear\ngreen pear pie\nblueberry\n");
    await waitForPersistedContent(
      sbServer,
      "Search.md",
      "green pear\ngreen pear pie\nblueberry\n",
    );
  });
});

test.describe("rich-text paste", () => {
  test.use({ spaceFiles: { "Paste.md": "" } });

  test("rich HTML becomes linked and formatted markdown on first paste", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Paste");
    const editor = page.locator("#sb-editor .cm-content");
    await editor.click();

    await page.evaluate(() => {
      const clipboardData = new DataTransfer();
      clipboardData.setData(
        "text/html",
        '<strong>Hello</strong> <em>world</em> <a href="https://example.com">Reference</a>',
      );
      clipboardData.setData("text/plain", "Hello world Reference");
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "clipboardData", { value: clipboardData });
      document.querySelector("#sb-editor .cm-content")!.dispatchEvent(event);
    });

    await waitForPersistedContent(
      sbServer,
      "Paste.md",
      /\*\*Hello\*\* \*world\* \[Reference\]\(https:\/\/example\.com\)/,
    );
    await gotoSilverBulletPage(page, sbServer, "Paste");
    await expect
      .poll(() => editorText(page))
      .toMatch(
        /\*\*Hello\*\* \*world\* \[Reference\]\(https:\/\/example\.com\)/,
      );
  });
});

test.describe("extension-assisted editing", () => {
  test.use({
    spaceFiles: {
      "Completion.md": [
        "# Completion",
        "",
        "```space-lua",
        "editor.getT",
        "```",
        "",
      ].join("\n"),
      "Review.md": [
        "Before.",
        "",
        "<!--",
        "",
        "* [ ] Follow up",
        "",
        "-->",
        "",
        "After.",
        "",
      ].join("\n"),
    },
  });

  test("Lua completion inserts a documented API call", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Completion");
    await page.evaluate(async () => {
      const client = (globalThis as any).client;
      const view = client.editorView;
      const text = view.state.doc.toString();
      const cursor = text.indexOf("editor.getT") + "editor.getT".length;
      view.dispatch({ selection: { anchor: cursor } });
      view.focus();
    });

    await expect(page.locator(".cm-content")).toBeFocused();
    await page.keyboard.press("Control+Space");

    const option = page.locator(".cm-tooltip-autocomplete li", {
      hasText: "getText()",
    });
    await expect(option).toBeVisible();
    await expect(option.locator(".cm-completionDetail")).toContainText(
      "full text",
    );
    await option.click();

    await waitForPersistedContent(
      sbServer,
      "Completion.md",
      /editor\.getText\(\)/,
    );
  });

  test("resolving a rendered comment removes the whole comment", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Review");
    await expect(
      page.locator(".sb-comment-block", { hasText: "Follow up" }),
    ).toBeVisible();
    await expect(
      page.locator('.sb-comment-block input[type="checkbox"]'),
    ).toHaveCount(1);

    await page.locator(".sb-comment-resolve").first().click();
    await waitForPersistedContent(
      sbServer,
      "Review.md",
      /^(?![\s\S]*Follow up)[\s\S]*Before\.[\s\S]*After\./,
    );
    const saved = await (
      await page.request.get(`${sbServer.url}/.fs/Review.md`)
    ).text();
    expect(saved).not.toMatch(/<!--|-->/);
  });
});

test.describe("page meta in widgets", () => {
  test.use({
    spaceFiles: {
      "Status.md":
        "---\nstatus: draft\n---\n# Status\n\nMeta: ${editor.getCurrentPageMeta().status}\n\nContext: ${_CTX.currentPage.status}\n",
    },
  });

  test("widgets reflect frontmatter edits without a reload", async ({
    page,
    sbServer,
  }) => {
    await gotoSilverBulletPage(page, sbServer, "Status");
    const content = page.locator("#sb-editor .cm-content");
    await expect(content).toContainText("Meta: draft");
    await expect(content).toContainText("Context: draft");

    await selectText(page, "draft");
    await page.keyboard.insertText("published");
    await waitForPersistedContent(sbServer, "Status.md", /status: published/);

    await expect(content).toContainText("Meta: published");
    await expect(content).toContainText("Context: published");
  });
});

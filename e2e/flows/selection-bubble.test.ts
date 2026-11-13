import type { Page } from "@playwright/test";
import { docText, runCommandViaPalette } from "../fixtures/actions.ts";
import { expect, gotoSilverBulletPage, test } from "../fixtures/core.ts";

const spaceFiles = {
  "index.md": "Welcome",
  "Notes/Plain.md": "Intro\n\nBody text here.\n",
  "Notes/Code.md": "Intro\n\n```\nsome code here\n```\n\nAfter\n",
};

function selectedText(page: Page): Promise<string> {
  return page.evaluate(() => {
    const state = (globalThis as any).client.editorView.state;
    const { from, to } = state.selection.main;
    return state.sliceDoc(from, to);
  });
}

function bubble(page: Page) {
  return page.getByRole("toolbar", { name: "Formatting" });
}

// Double-clicks the first word of a line: a mouse selection
async function selectFirstWord(page: Page, lineText: string, word: string) {
  const line = page.locator(".cm-line", { hasText: lineText }).first();
  const box = (await line.boundingBox())!;
  await page.mouse.dblclick(box.x + 6, box.y + box.height / 2);
  await expect.poll(() => selectedText(page)).toBe(word);
}

test.describe("the selection bubble", () => {
  test.use({ spaceFiles });

  test("selecting a word with the mouse shows the bubble; Bold wraps it in **", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Plain");
    await expect(bubble(sbPage)).toHaveCount(0);
    await selectFirstWord(sbPage, "Body text here.", "Body");
    await expect(bubble(sbPage)).toBeVisible();

    // Above the selection
    const box = (await bubble(sbPage).boundingBox())!;
    const line = (await sbPage
      .locator(".cm-line", { hasText: "Body text here." })
      .boundingBox())!;
    expect(box.y + box.height).toBeLessThanOrEqual(line.y + 1);

    const bold = bubble(sbPage).getByRole("button", { name: "Bold" });
    await expect(bold).toHaveAttribute("title", /^Bold/);
    await bold.click();
    await expect
      .poll(() => docText(sbPage))
      .toBe("Intro\n\n**Body** text here.\n");
    // The editor kept its focus and a selection, so the bubble stays up
    await expect(sbPage.locator(".cm-content")).toBeFocused();
    await expect(bubble(sbPage)).toBeVisible();

    await sbPage.keyboard.press("Escape");
    await expect(bubble(sbPage)).toHaveCount(0);
  });

  test("after a button edit, clicking away and re-selecting the same text shows the bubble again", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Plain");
    await selectFirstWord(sbPage, "Body text here.", "Body");
    await bubble(sbPage).getByRole("button", { name: "Bold" }).click();
    await expect
      .poll(() => docText(sbPage))
      .toBe("Intro\n\n**Body** text here.\n");

    // Click away, at the far end of the "Intro" line (the bubble floats over
    // the start of the lines above "Body"), then select "Body" again
    const intro = (await sbPage
      .locator(".cm-line", { hasText: "Intro" })
      .first()
      .boundingBox())!;
    await sbPage.mouse.click(
      intro.x + intro.width - 10,
      intro.y + intro.height / 2,
    );
    await expect(bubble(sbPage)).toHaveCount(0);
    // Select "Body" again (a double-click would hit the revealed ** markers)
    await sbPage.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      const from = view.state.doc.toString().indexOf("Body");
      view.dispatch({ selection: { anchor: from, head: from + 4 } });
    });
    await expect.poll(() => selectedText(sbPage)).toBe("Body");
    await expect(bubble(sbPage)).toBeVisible();
  });

  test("the bubble hides when typing replaces the selection", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Plain");
    await selectFirstWord(sbPage, "Body text here.", "Body");
    await expect(bubble(sbPage)).toBeVisible();
    await sbPage.keyboard.type("X");
    await expect.poll(() => docText(sbPage)).toBe("Intro\n\nX text here.\n");
    await expect(bubble(sbPage)).toHaveCount(0);
  });

  test("no bubble inside fenced code", async ({ sbPage, sbServer }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Code");
    await selectFirstWord(sbPage, "some code here", "some");
    // A frame for the bubble to have shown, were it to
    await sbPage.evaluate(
      () => new Promise((done) => requestAnimationFrame(done)),
    );
    await expect(bubble(sbPage)).toHaveCount(0);

    // A word outside the block does get one
    await selectFirstWord(sbPage, "After", "After");
    await expect(bubble(sbPage)).toBeVisible();
  });

  test("no bubble with the markup bar toggled off", async ({
    sbPage,
    sbServer,
  }) => {
    await gotoSilverBulletPage(sbPage, sbServer, "Notes/Plain");
    await runCommandViaPalette(sbPage, "Editor: Toggle Markup Bar");
    await selectFirstWord(sbPage, "Body text here.", "Body");
    await sbPage.evaluate(
      () => new Promise((done) => requestAnimationFrame(done)),
    );
    await expect(bubble(sbPage)).toHaveCount(0);
  });
});

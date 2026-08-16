import { expect, mod, test } from "./fixtures.ts";

// Inline comments: signed HTML-comment notes (`<!-- message — author, YYYY-MM-DD -->`),
// optionally `@addressee:`-addressed to hand a question off, that render as a
// card widget when the cursor is outside them, and as raw markdown when the
// cursor overlaps the block. See plug-api/lib/comments.ts,
// plugs/index/comment.ts, client/codemirror/comment_widget.ts, and
// plugs/editor/comments.ts.

test.describe("Comment card rendering", () => {
  test.use({
    spaceFiles: {
      "index.md": "A claim.\n<!-- @pete: verify — john, 2026-08-04 -->\n",
    },
  });

  test("conforming comment renders as card; cursor reveals raw", async ({
    sbPage,
  }) => {
    const editor = sbPage.locator("#sb-editor .cm-content");
    const card = editor.locator(".sb-comment-card");

    // Cursor starts at doc position 0, outside the comment block, so it
    // should already render as a card.
    await expect(card).toBeVisible();
    await expect(card).toContainText("@pete");
    await expect(card).toContainText("verify");
    await expect(editor).not.toContainText("<!-- @pete:");

    // Move the cursor into the paragraph line (still outside the block) --
    // an explicit "elsewhere" placement before we walk into the block.
    await editor.locator(".cm-line").first().click();
    await expect(card).toBeVisible();

    // Mouse clicks on the widget itself don't move the *document* cursor
    // into it (CodeMirror's own click-to-cursor mapping on a block-replace
    // widget lands at its edge, and the decorator field explicitly skips
    // recomputation for "select.pointer" transactions -- see
    // decoratorStateField in client/codemirror/util.ts -- to avoid the card
    // flickering away under a plain click). Walking in with the keyboard is
    // a real, distinct transaction and does trigger recomputation.
    await sbPage.keyboard.press("End");
    await sbPage.keyboard.press("ArrowDown");

    await expect(card).toHaveCount(0);
    await expect(editor).toContainText("<!-- @pete:");
    await expect(editor).toContainText("verify");
  });

  test("alt-click on the card reveals raw source", async ({ sbPage }) => {
    const editor = sbPage.locator("#sb-editor .cm-content");
    const card = editor.locator(".sb-comment-card");
    await expect(card).toBeVisible();

    await card.click({ modifiers: ["Alt"] });

    await expect(card).toHaveCount(0);
    await expect(editor).toContainText("<!-- @pete:");
  });
});

test.describe("Comment: Add command", () => {
  test.use({
    spaceFiles: {
      "index.md": "Some claim worth quoting.\n",
    },
  });

  test("Comment: Add inserts scaffold with quoted selection", async ({
    sbPage,
  }) => {
    const editor = sbPage.locator("#sb-editor .cm-content");
    await expect(editor).toContainText("Some claim worth quoting.");

    // Select "claim worth" (offsets 5..16 in "Some claim worth quoting.").
    await editor.click();
    await sbPage.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      view.dispatch({ selection: { anchor: 5, head: 16 } });
    });

    // Run "Comment: Add" via its keybinding (Cmd-Alt-c on mac, Ctrl-Alt-c
    // elsewhere -- see plugs/editor/editor.plug.yaml).
    await sbPage.keyboard.press(`${mod}+Alt+c`);

    await expect(editor).toContainText('<!-- re: "claim worth"');

    // Left-aligned (no indentation), closer on its own line -- a quoted
    // scaffold is multi-line, so buildCommentScaffold puts `-->` on a third
    // line (see plug-api/lib/comments.ts).
    const doc = await sbPage.evaluate(() =>
      (globalThis as any).client.editorView.state.doc.toString(),
    );
    expect(doc).toContain('<!-- re: "claim worth"\n');
    // trimEnd() because the fixture page's own trailing newline survives
    // after the inserted block (computeCommentInsertion inserts before it).
    expect(doc.trimEnd().endsWith("\n-->")).toBe(true);
    expect(doc).not.toContain("     —");
    expect(doc).not.toContain("     @");

    const result = await sbPage.evaluate(() => {
      const view = (globalThis as any).client.editorView;
      const pos = view.state.selection.main.head;
      return {
        // Nothing has been typed yet, so the message position sits right
        // before the signature's leading " — ".
        afterCursor: view.state.doc.sliceString(pos, pos + 15),
      };
    });
    // Cursor lands at the message position, before the " — <date>" signature
    // -- there's no "@" addressee slot to land in any more (addressing is
    // optional; see plug-api/lib/comments.ts buildCommentScaffold).
    expect(result.afterCursor.trimStart().startsWith("—")).toBe(true);
    await expect(editor).not.toContainText("@:");
  });
});

test.describe("Comment reply/resolve round-trip", () => {
  test.use({
    spaceFiles: {
      "index.md": "Some text.\n<!-- @pete: verify — john, 2026-08-04 -->\n",
    },
  });

  test("reply and resolve round-trip with undo", async ({ sbPage }) => {
    const editor = sbPage.locator("#sb-editor .cm-content");
    const card = editor.locator(".sb-comment-card");
    await expect(card).toBeVisible();

    const docText = () =>
      sbPage.evaluate(() =>
        (globalThis as any).client.editorView.state.doc.toString(),
      );

    // Click Reply -> a pre-addressed line is inserted and the cursor lands
    // ready to type the reply body (see CommentCardWidget.reply()).
    await card.locator("button", { hasText: "Reply" }).click();
    await sbPage.keyboard.type("on it");

    // Left-aligned reply line (addressed back to the original message's
    // author, "john"), and the closer relocated onto its own line -- the
    // block was single-line with an inline closer before the reply (see
    // buildReplyInsertion in client/codemirror/comment_widget.ts).
    const docWhileEditing = await docText();
    expect(docWhileEditing).toContain("@john: on it");
    expect(docWhileEditing).not.toContain("     @john: on it");
    expect(docWhileEditing.trimEnd().endsWith("\n-->")).toBe(true);

    // Move the cursor back out of the block to collapse it to a card again.
    await sbPage.evaluate(() => {
      (globalThis as any).client.editorView.dispatch({
        selection: { anchor: 0 },
      });
    });

    await expect(card).toBeVisible();
    await expect(card.locator(".sb-comment-message")).toHaveCount(2);
    await expect(card).toContainText("on it");

    // Click Resolve -> the whole comment block is removed from the document.
    await card.locator("button", { hasText: "Resolve" }).click();
    await expect.poll(docText).not.toContain("<!-- @pete:");

    // Undo restores the comment block into the document model (whether it
    // re-renders as a card or as raw text depends on where undo leaves the
    // cursor, so assert on the document content rather than the DOM).
    await editor.click();
    await sbPage.keyboard.press(`${mod}+z`);
    await expect.poll(docText).toContain("<!-- @pete:");
    await expect.poll(docText).toContain("on it");
  });
});

test.describe("Comment on an unaddressed note", () => {
  test.use({
    spaceFiles: {
      "index.md":
        'A claim.\n<!-- re: "the surrounding text"\n     Commenting on a specific phrase — 2026-08-05 -->\n',
    },
  });

  // Reply only makes sense when there's someone to reply to -- an
  // unaddressed note offers Resolve but no Reply button (see
  // CommentCardWidget.toDOM() in client/codemirror/comment_widget.ts).
  // buildReplyInsertion's unaddressed fallback path stays in place as a
  // safeguard for mixed threads (addressed earlier, unaddressed last), but
  // that path is no longer reachable from this card's UI.
  test("an unaddressed note's card offers Resolve but no Reply button", async ({
    sbPage,
  }) => {
    const editor = sbPage.locator("#sb-editor .cm-content");
    const card = editor.locator(".sb-comment-card");
    await expect(card).toBeVisible();
    await expect(card.locator(".sb-comment-message")).toHaveCount(1);

    await expect(card.locator("button", { hasText: "Resolve" })).toBeVisible();
    await expect(card.locator("button", { hasText: "Reply" })).toHaveCount(0);
  });
});

// "published render hides comments": there is no e2e-reachable surface for
// rendered/published HTML in this app (no share/preview route -- the client
// only ever shows the editable CodeMirror view). Per the brief, the fallback
// lives as a vitest case in client/markdown_renderer/markdown_render.test.ts
// ("Conforming inline comment renders to nothing"), asserting CommentBlock
// renders to null (empty HTML) for a conforming comment.

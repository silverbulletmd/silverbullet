import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

// HTML comments are ordinary markdown: the body is parsed and rendered live,
// the `<!--`/`-->` markers are hidden while the cursor is elsewhere, and a
// Resolve button on the closing line deletes the whole block. See
// client/markdown_parser/html_block.ts and client/codemirror/comment_region.ts.

test.use({
  spaceFiles: {
    "Code.md": [
      "```javascript",
      "const x = 1;",
      "```",
      "",
      "Some prose.",
      "",
    ].join("\n"),
    "Commented.md": [
      "Before.",
      "",
      "<!--",
      "",
      "* [ ] Hello",
      "",
      "-->",
      "",
      "<!-- TODO: fix this -->",
      "",
      "After.",
      "",
    ].join("\n"),
  },
});

const editorText = (page: any) =>
  page.evaluate(
    () => (document.querySelector(".cm-content") as HTMLElement).innerText,
  );

const docText = (page: any) =>
  page.evaluate(() =>
    (globalThis as any).client.editorView.state.doc.toString(),
  );

test("a comment renders its body as live markdown with hidden markers", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Commented");
  await page.waitForSelector(".sb-comment-block");

  const visible = await editorText(page);
  expect(visible).not.toContain("<!--\n");
  expect(visible).not.toContain("\n-->");
  expect(visible).toContain("Hello");

  // The task inside the comment is a real, rendered task.
  expect(
    await page.locator(".sb-comment-block input[type=checkbox]").count(),
  ).toBe(1);
});

test("a one-liner keeps its markers visible", async ({ sbServer, page }) => {
  await gotoSilverBulletPage(page, sbServer, "Commented");
  await page.waitForSelector(".sb-comment-block");

  // An inline marker is never replaced -- hiding it would shift the text
  // sideways as the cursor moves in and out.
  expect(await editorText(page)).toContain("<!-- TODO: fix this -->");
});

test("putting the cursor inside reveals the raw markers", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Commented");
  await page.waitForSelector(".sb-comment-block");

  await page.evaluate(() => {
    const client = (globalThis as any).client;
    const doc = client.editorView.state.doc.toString();
    client.editorView.dispatch({
      selection: { anchor: doc.indexOf("Hello") },
    });
  });

  await page.waitForFunction(() =>
    (document.querySelector(".cm-content") as HTMLElement).innerText.includes(
      "<!--\n",
    ),
  );
});

test("Resolve deletes the whole comment", async ({ sbServer, page }) => {
  await gotoSilverBulletPage(page, sbServer, "Commented");
  await page.waitForSelector(".sb-comment-resolve");

  await page.locator(".sb-comment-resolve").first().click();

  await page.waitForFunction(() => {
    const doc = (globalThis as any).client.editorView.state.doc.toString();
    return !doc.includes("Hello");
  });
  const doc = await docText(page);
  expect(doc).toContain("Before.");
  expect(doc).toContain("After.");
  // Only the block comment went; the one-liner is untouched.
  expect(doc).toContain("<!-- TODO: fix this -->");
});

test("Comment: Selection uses the language's own syntax inside fenced code", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Code");
  await page.waitForSelector(".sb-line-fenced-code");

  const runOn = async (needle: string) => {
    await page.evaluate((needle: string) => {
      const view = (globalThis as any).client.editorView;
      const at = view.state.doc.toString().indexOf(needle);
      view.dispatch({ selection: { anchor: at, head: at + needle.length } });
    }, needle);
    await page.evaluate(() =>
      (globalThis as any).client.runCommandByName("Comment: Selection")
    );
  };
  const doc = () =>
    page.evaluate(() =>
      (globalThis as any).client.editorView.state.doc.toString()
    );

  await runOn("const x = 1;");
  await expect.poll(doc).toContain("// const x = 1;");
  // An HTML comment inside a code block would just be code.
  expect(await doc()).not.toContain("<!--\nconst x");

  // Running it again uncomments, as CodeMirror's toggle does.
  await runOn("// const x = 1;");
  await expect.poll(doc).not.toContain("// const x = 1;");

  // Prose outside the block still gets an HTML comment.
  await runOn("Some prose.");
  await expect.poll(doc).toContain("<!--\nSome prose.\n-->");
});

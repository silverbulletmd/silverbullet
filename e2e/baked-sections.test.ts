import { expect, gotoSilverBulletPage, test } from "./fixtures.ts";

test.use({
  spaceFiles: {
    "Bake.md":
      `Before\n\n<!--#lua 3 + 4 -->\nstale\n<!--/lua-->\n\nAfter\n`,
    "BakeButton.md":
      "Table:\n\n${ { {name = \"a\"}, {name = \"b\"} } }\n",
    // A Lua-registered code widget that renders its body as block markdown.
    // Its rendered block gets a button bar, but it must NOT get a Bake button:
    // baking rewrites the source to `<!--#lua EXPR -->` where EXPR is a Lua
    // expression, and a fenced block's body (here "world") is not one.
    "FencedNoBake.md":
      '```space-lua\nconfig.set({"codeWidgets", "greet"}, {\n  language = "greet",\n  render = function(bodyText)\n    return "## Hello " .. bodyText .. "\\n\\nA greeting block."\n  end\n})\n```\n\n```greet\nworld\n```\n',
  },
});

test("'Baked Sections: Update' rewrites a section body with the evaluated result", async ({ sbServer, page }) => {
  await gotoSilverBulletPage(page, sbServer, "Bake");

  await page.waitForFunction(
    () => !!(globalThis as any).client?.editorView,
    undefined,
    { timeout: 10_000 },
  );

  await page.evaluate(() =>
    (globalThis as any).client.runCommandByName(
      "Baked Sections: Update",
    )
  );

  await page.waitForFunction(() => {
    const doc = (globalThis as any).client.editorView.state.doc.toString();
    return doc.includes("<!--#lua 3 + 4 -->\n7\n<!--/lua-->");
  }, undefined, { timeout: 10_000 });

  const doc = await page.evaluate(() =>
    (globalThis as any).client.editorView.state.doc.toString()
  );
  expect(doc).toContain("<!--#lua 3 + 4 -->\n7\n<!--/lua-->");
  expect(doc).not.toContain("stale");
});

test("'Baked Sections: Unbake Section At Cursor' restores the section to ${…} form", async ({ sbServer, page }) => {
  await gotoSilverBulletPage(page, sbServer, "Bake");

  await page.waitForFunction(
    () => !!(globalThis as any).client?.editorView,
    undefined,
    { timeout: 10_000 },
  );

  // Place the cursor inside the baked section, then unbake it.
  await page.evaluate(() => {
    const view = (globalThis as any).client.editorView;
    const idx = view.state.doc.toString().indexOf("<!--#lua");
    view.dispatch({ selection: { anchor: idx + 2 } });
  });

  await page.evaluate(() =>
    (globalThis as any).client.runCommandByName(
      "Baked Sections: Unbake Section At Cursor",
    )
  );

  await page.waitForFunction(() => {
    const doc = (globalThis as any).client.editorView.state.doc.toString();
    return doc.includes("${3 + 4}");
  }, undefined, { timeout: 10_000 });

  const doc = await page.evaluate(() =>
    (globalThis as any).client.editorView.state.doc.toString()
  );
  expect(doc).toContain("${3 + 4}");
  expect(doc).not.toContain("<!--#lua");
  expect(doc).not.toContain("<!--/lua-->");
});

// A record-array result renders as a block table → block widget → button bar.
test("bake button converts a ${} directive to comment form", async ({ sbServer, page }) => {
  await gotoSilverBulletPage(page, sbServer, "BakeButton");

  // The button bar is `display: none` until the widget is hovered
  // (editor.scss: `.sb-lua-directive-block:hover .button-bar`). Hover the
  // widget to reveal the bar, then click the Bake button.
  const widget = page.locator("#sb-editor .sb-lua-directive-block").first();
  await widget.waitFor({ state: "visible", timeout: 10_000 });
  await widget.hover();

  const btn = page
    .locator('#sb-editor .button-bar button[data-button="bake"]')
    .first();
  await btn.click({ timeout: 10_000 });

  await page.waitForFunction(() => {
    const doc = (globalThis as any).client.editorView.state.doc.toString();
    return doc.includes("<!--#lua") && doc.includes("<!--/lua-->");
  }, undefined, { timeout: 10_000 });

  const doc = await page.evaluate(() =>
    (globalThis as any).client.editorView.state.doc.toString()
  );
  expect(doc).toContain("<!--#lua");
  expect(doc).toContain("<!--/lua-->");
  // The baked body is the clean GFM table, not an empty span.
  expect(doc).toContain("|name|");
  expect(doc).toContain("|a|");
  expect(doc).not.toContain("${");
});

// Regression guard: the Bake button is for live `${…}` Lua directives only.
// Widgets that originate from fenced code blocks (e.g. ```mermaid, ```greet)
// must not get one — their body is not a Lua expression to re-evaluate.
test("fenced code block widgets do not get a Bake button", async ({ sbServer, page }) => {
  await gotoSilverBulletPage(page, sbServer, "FencedNoBake");

  // Wait for the `greet` code widget to render as a block widget (this only
  // happens once the space-lua `codeWidget.define` has loaded).
  const widget = page
    .locator("#sb-editor .sb-lua-directive-block")
    .filter({ hasText: "Hello world" })
    .first();
  await widget.waitFor({ state: "visible", timeout: 15_000 });
  await widget.hover();

  // The button bar must have rendered (Reload is always present for a block
  // widget), proving we're actually inspecting a real button bar...
  await expect(
    widget.locator('.button-bar button[data-button="reload"]'),
  ).toHaveCount(1);
  // ...but there must be no Bake button.
  await expect(
    widget.locator('.button-bar button[data-button="bake"]'),
  ).toHaveCount(0);
});

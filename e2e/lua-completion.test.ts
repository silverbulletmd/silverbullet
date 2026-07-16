import { expect, gotoSilverBulletPage, mod, test } from "./fixtures.ts";

test.use({
  spaceFiles: {
    "LuaCompletion.md": `# Lua completion

\`\`\`space-lua
lua.parseB
string.gs
editor.setT
editor.getT
system.invokeF
jumpdemo.target()
\`\`\`
`,
    "LuaDefinitions.md": `#meta

\`\`\`space-lua
jumpdemo = {}

function jumpdemo.target()
  return "definition"
end
\`\`\`
`,
  },
});

test("Lua API completion shows signatures and documentation", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "LuaCompletion");

  const startCompletionAt = async (prefix: string) => {
    await page.evaluate(async (prefix) => {
      const client = (globalThis as any).client;
      const view = client.editorView;
      const text = view.state.doc.toString();
      const cursor = text.indexOf(prefix) + prefix.length;
      view.dispatch({ selection: { anchor: cursor } });
      view.focus();
      await client.clientSystem.localSyscall("editor.startCompletion", []);
    }, prefix);
  };

  await startCompletionAt("lua.parseB");

  const luaOption = page.locator(".cm-tooltip-autocomplete li", {
    hasText: "parseBlock(code)",
  });
  await expect(luaOption).toBeVisible();
  await expect(luaOption.locator(".cm-completionDetail")).toHaveText(
    "Parses a Space Lua chunk and returns its AST. Blocks retain comments in source order with their exact text, kind, and source range.",
  );

  const documentation = page.locator(
    ".cm-completionInfo .sb-completion-documentation",
  );
  await expect(documentation).toBeVisible();
  await expect(documentation.locator(":scope > h3")).toBeHidden();
  await expect(documentation).toContainText("lua.parseBlock(code)");
  await expect(documentation).toContainText(
    "Parses a Space Lua chunk and returns its AST.",
  );
  await expect(documentation).toContainText("Parameters:");
  await expect(documentation).toContainText("code");
  await expect(documentation).toContainText("Lua code to parse.");
  await luaOption.click({ force: true });

  const appliedCompletion = await page.evaluate(() => {
    const view = (globalThis as any).client.editorView;
    const selection = view.state.selection.main;
    const line = view.state.doc.lineAt(selection.head);
    return {
      line: line.text,
      cursorOffset: selection.head - line.from,
      selectionEmpty: selection.empty,
    };
  });
  expect(appliedCompletion).toEqual({
    line: "lua.parseBlock()",
    cursorOffset: "lua.parseBlock(".length,
    selectionEmpty: true,
  });

  await page.keyboard.press("Escape");
  await startCompletionAt("string.gs");

  const builtinOption = page.locator(".cm-tooltip-autocomplete li", {
    hasText: "gsub(s, pattern, replacement, n?)",
  });
  await expect(builtinOption).toBeVisible();
  await expect(builtinOption.locator(".cm-completionDetail")).toHaveText(
    "Replaces Lua-pattern matches using a string, table, or function replacement.",
  );

  await page.keyboard.press("Escape");
  await startCompletionAt("editor.setT");

  const syscallWithParameters = page.locator(".cm-tooltip-autocomplete li", {
    hasText: "setText(newText, shouldIsolateHistory?)",
  });
  await expect(syscallWithParameters).toBeVisible();
  await expect(
    syscallWithParameters.locator(".cm-completionDetail"),
  ).toHaveText(
    "Updates the editor text with a minimal diff while preserving the cursor when possible.",
  );

  await page.keyboard.press("Escape");
  await startCompletionAt("editor.getT");

  const syscallWithoutParameters = page.locator(".cm-tooltip-autocomplete li", {
    hasText: "getText()",
  });
  await expect(syscallWithoutParameters).toBeVisible();
  await expect(
    syscallWithoutParameters.locator(".cm-completionDetail"),
  ).toHaveText("Returns the full text of the currently open page or document.");

  await page.keyboard.press("Escape");
  await startCompletionAt("system.invokeF");

  const signatureFallback = page.locator(".cm-tooltip-autocomplete li", {
    hasText: "invokeFunction(name, ...)",
  });
  await expect(signatureFallback).toBeVisible();
  await expect(signatureFallback.locator(".cm-completionDetail")).toHaveText(
    "Invokes a loaded plug function by its plug-qualified name.",
  );
});

test("modifier-click navigates to Lua function definitions", async ({
  sbServer,
  page,
}) => {
  await gotoSilverBulletPage(page, sbServer, "LuaCompletion");

  const coordinates = await page.evaluate(() => {
    const view = (globalThis as any).client.editorView;
    const text = view.state.doc.toString();
    const symbol = "jumpdemo.target";
    const position = text.indexOf(symbol) + "jumpdemo.".length + 2;
    const coordinates = view.coordsAtPos(position);
    if (!coordinates) throw new Error("Could not resolve symbol coordinates");
    return {
      x: coordinates.left + 2,
      y: (coordinates.top + coordinates.bottom) / 2,
    };
  });

  await page.keyboard.down(mod);
  await page.mouse.click(coordinates.x, coordinates.y);
  await page.keyboard.up(mod);

  await expect(page.locator("#sb-current-page input.sb-input")).toHaveValue(
    "LuaDefinitions",
  );
  await page.waitForURL(/\/LuaDefinitions$/);
});

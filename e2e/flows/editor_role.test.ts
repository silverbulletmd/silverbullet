import type { Page } from "@playwright/test";
import { adminApi, login, test } from "../fixtures/authenticated.ts";
import {
  expect,
  gotoSilverBulletPage,
  mod,
  waitForPersistedContent,
} from "../fixtures/core.ts";

const librarySource = [
  "# Installed cards",
  "```space-lua",
  "cards = {}",
  "--- @capabilities widget:render",
  "function cards.badge(label)",
  '  return widget.html(dom.span { __rawText = "Card: " .. label })',
  "end",
  'codeWidget.define { language="installed-card", render=function(body) return widget.html(dom.span { __rawText="Block: " .. body }) end }',
  "```",
].join("\n");
const sentinel = "Sentinel is unchanged";
const config = "# Space configuration\n";

async function settleWidgets(page: Page) {
  await page.evaluate(() => (globalThis as any).client.widgetsReady);
}

test("Editor saves notes and uses queries and installed widgets without authoring executable code", async ({
  adminPage: admin,
  browser,
  sbServer,
}) => {
  test.setTimeout(120_000);
  for (const username of ["rowan", "blair", "sage"]) {
    await adminApi(admin, sbServer, "POST", "users", {
      username,
      password: `${username}-test-password`,
    });
  }
  await adminApi(admin, sbServer, "POST", "spaces", {
    name: "Field notes",
    binding: { prefix: "/roles" },
    members: {
      rowan: { role: "read" },
      blair: { role: "edit" },
      sage: { role: "write" },
    },
  });
  const space = { ...sbServer, url: `${sbServer.url}/roles` };
  const fileUrl = (name: string) =>
    `${space.url}/.fs/${name.split("/").map(encodeURIComponent).join("/")}.md`;
  for (const [name, text] of Object.entries({
    "Library/EditorTest": librarySource,
    CONFIG: config,
    Notebook: "A field note.",
    "Notebook/Observation": "A child note.",
    Sentinel: sentinel,
    "Field Alpha": "---\ntags: fieldnote\n---\nFirst observation.",
    "Field Beta": "---\ntags: fieldnote\n---\nSecond observation.",
  })) {
    expect((await admin.request.put(fileUrl(name), { data: text })).ok()).toBe(
      true,
    );
  }

  const editorContext = await browser.newContext();
  const builderContext = await browser.newContext();
  const readerContext = await browser.newContext();
  try {
    const editor = await editorContext.newPage();
    await login(editor, sbServer, "blair", "blair-test-password");
    await gotoSilverBulletPage(editor, space, "Notebook");
    await editor.locator(".cm-content").click();
    await editor.keyboard.press(`${mod}+End`);
    await editor.keyboard.insertText(" Updated by an Editor.");
    await waitForPersistedContent(
      space,
      "Notebook.md",
      "A field note. Updated by an Editor.",
      editor.request,
    );

    for (const [name, original] of [
      ["Library/EditorTest", librarySource],
      ["CONFIG", config],
    ]) {
      expect(
        (
          await editor.request.put(fileUrl(name), {
            data: "Forbidden replacement",
          })
        ).status(),
      ).toBe(403);
      await gotoSilverBulletPage(editor, space, name);
      await expect(editor.locator(".cm-content")).toHaveAttribute(
        "contenteditable",
        "false",
      );
      await editor.locator(".cm-content").click();
      await editor.keyboard.insertText("Forbidden replacement");
      await expect(editor.locator(".cm-content")).not.toContainText(
        "Forbidden replacement",
      );
      expect(await (await editor.request.get(fileUrl(name))).text()).toBe(
        original,
      );
    }

    const attack =
      "return fetch('/roles/.fs/Sentinel.md', {method: 'PUT', body: 'Overwritten by JavaScript'})";
    const report = [
      "# Field report",
      '${query[[from p = index.pages("fieldnote") where p.name != "Sentinel" order by p.name desc select { Title = p.name }]]}',
      '${cards.badge("Ready")}',
      '${widgets.subPages("Notebook")}',
      "```installed-card\nReady\n```",
      `\${js.window.Function(${JSON.stringify(attack)})()}`,
      "End of report.",
    ].join("\n\n");
    expect(
      (await editor.request.put(fileUrl("Report"), { data: report })).ok(),
    ).toBe(true);
    expect(
      (
        await editor.request.put(fileUrl("Untrusted Script"), {
          data: '```space-lua\nspace.writePage("Sentinel", "Overwritten by ordinary Space Lua")\n```\n\n```data\n$ref: Library/Forged\ntags: space-lua\nscript: space.writePage("Sentinel", "Overwritten by tagged data")\n```',
        })
      ).ok(),
    ).toBe(true);

    await gotoSilverBulletPage(editor, space, "Report");
    await settleWidgets(editor);
    const rows = editor.locator("#sb-editor table tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Field Beta");
    await expect(rows.nth(1)).toContainText("Field Alpha");
    await expect(
      editor.locator("#sb-editor").getByText("Card: Ready", { exact: true }),
    ).toBeVisible();
    await expect(editor.locator("#sb-editor")).toContainText("Observation");
    await expect(editor.locator("#sb-editor")).toContainText("Block: Ready");
    await expect(editor.locator("#sb-editor .sb-lua-error")).toHaveCount(1);
    expect(await (await editor.request.get(fileUrl("Sentinel"))).text()).toBe(
      sentinel,
    );

    const builder = await builderContext.newPage();
    await login(builder, sbServer, "sage", "sage-test-password");
    await gotoSilverBulletPage(builder, space, "Report");
    await settleWidgets(builder);
    await expect(
      builder.locator("#sb-editor").getByText("Card: Ready", { exact: true }),
    ).toBeVisible();
    await expect(builder.locator("#sb-editor .sb-lua-error")).toHaveCount(1);
    expect(await (await builder.request.get(fileUrl("Sentinel"))).text()).toBe(
      sentinel,
    );
    expect(
      (
        await builder.request.put(fileUrl("CONFIG"), {
          data: `${config}Builder configuration.\n`,
        })
      ).ok(),
    ).toBe(true);

    const reader = await readerContext.newPage();
    await login(reader, sbServer, "rowan", "rowan-test-password");
    await gotoSilverBulletPage(reader, space, "Notebook");
    await expect(reader.locator(".cm-content")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(
      (
        await reader.request.put(fileUrl("Notebook"), { data: "Reader edit" })
      ).status(),
    ).toBe(403);
    await waitForPersistedContent(
      space,
      "Notebook.md",
      "A field note. Updated by an Editor.",
      reader.request,
    );
  } finally {
    await editorContext.close();
    await builderContext.close();
    await readerContext.close();
  }
});

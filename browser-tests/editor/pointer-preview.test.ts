import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function mountEditor(
  page: import("@playwright/test").Page,
  wiki = true,
  customDoc?: string,
) {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../client/", import.meta.url)),
      contents: `
        import { EditorState } from "@codemirror/state";
        import { EditorView, keymap } from "@codemirror/view";
        import { defaultKeymap } from "@codemirror/commands";
        import { MainUI } from "./editor_ui.tsx";
        import { BasenameIndex } from "../plug-api/lib/resolve_path.ts";
        import { cleanWikiLinkPlugin } from "./codemirror/syntax/wiki_link.ts";
        import { extendedMarkdownLanguage } from "./markdown_parser/parser.ts";
        import { linkPlugin } from "./codemirror/syntax/link.ts";
        import { pointerPreview } from "./codemirror/editing/pointer_preview.ts";
        const doc = ${JSON.stringify(customDoc ?? `Look at the ${wiki ? "[[Library|Libraries]]" : "[Libraries](Library)"} you can install.`)};
        const client = {
          currentName: () => "Preview test", currentPath: () => "Preview test.md",
          config: { get: (_key, fallback) => fallback },
          clientSystem: { allKnownFiles: new BasenameIndex(), knownFilesLoaded: true },
          ui: { viewState: { uiOptions: { markdownSyntaxRendering: false }, allPages: [] } },
        };
        const view = new EditorView({ parent: document.body, state: EditorState.create({
          doc, selection: { anchor: doc.indexOf('Libraries') + 2 },
          extensions: [extendedMarkdownLanguage, pointerPreview, linkPlugin(client), cleanWikiLinkPlugin(client), keymap.of(defaultKeymap)],
        }) });
        client.editorView = view;
        client.focus = () => view.focus();
        new MainUI({ editorView: view });
        globalThis.view = view;
        view.focus();
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    jsxImportSource: "preact",
    logLevel: "silent",
  });
  await page.addStyleTag({ content: ".cm-editor { font: 24px monospace; }" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  return page.evaluate(() => {
    const view = (globalThis as any).view;
    const box = view.coordsAtPos(
      view.state.doc.toString().indexOf("install") + 3,
    );
    return { x: box.left, y: (box.top + box.bottom) / 2 };
  });
}

async function selectedText(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const { state } = (globalThis as any).view;
    return state.sliceDoc(state.selection.main.from, state.selection.main.to);
  });
}

test("double click selects the word under the original pointer even across a preview refresh", async ({
  page,
}) => {
  const point = await mountEditor(page);
  await page.mouse.click(point.x, point.y);
  // A normal editor transaction during the gap must not move the target either.
  await page.evaluate(() => {
    const view = (globalThis as any).view;
    view.dispatch({ selection: view.state.selection });
  });
  await expect(page.locator(".cm-content")).toContainText(
    "[[Library|Libraries]]",
  );
  await page.mouse.click(point.x, point.y, { clickCount: 2 });
  await expect.poll(() => selectedText(page)).toBe("install");
  await page.waitForTimeout(350);
  expect(await page.locator(".cm-content").textContent()).not.toContain(
    "[[Library|",
  );
  await expect.poll(() => selectedText(page)).toBe("install");
  await expect
    .poll(() => page.evaluate(() => getSelection()?.toString()))
    .toBe("install");
  await page.keyboard.type("add");
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as any).view.state.doc.toString()),
    )
    .toBe("Look at the [[Library|Libraries]] you can add.");
  await expect(page.locator(".cm-content")).not.toContainText("[[Library|");
});

test("single click restores preview within 180 ms", async ({ page }) => {
  const point = await mountEditor(page);
  await page.mouse.click(point.x, point.y);
  await expect(page.locator(".cm-content")).toContainText(
    "[[Library|Libraries]]",
  );
  await page.waitForTimeout(180);
  expect(await page.locator(".cm-content").textContent()).not.toContain(
    "[[Library|",
  );
});

test("drag selection survives preview recovery after releasing the mouse", async ({
  page,
}) => {
  const point = await mountEditor(page);
  const end = await page.evaluate(() => {
    const view = (globalThis as any).view;
    const box = view.coordsAtPos(view.state.doc.length - 1);
    return { x: box.left, y: (box.top + box.bottom) / 2 };
  });
  await page.mouse.move(point.x, point.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.waitForTimeout(350);
  await expect(page.locator(".cm-content")).toContainText(
    "[[Library|Libraries]]",
  );
  await page.mouse.up();
  await expect.poll(() => selectedText(page)).toBe("tall");
  await page.waitForTimeout(350);
  expect(await page.locator(".cm-content").textContent()).not.toContain(
    "[[Library|",
  );
  await expect.poll(() => selectedText(page)).toBe("tall");
});

test("ordinary Markdown links also keep the double click target stable", async ({
  page,
}) => {
  const point = await mountEditor(page, false);
  await page.mouse.click(point.x, point.y);
  await page.evaluate(() => (globalThis as any).view.dispatch({}));
  await page.mouse.click(point.x, point.y, { clickCount: 2 });
  await expect.poll(() => selectedText(page)).toBe("install");
});

test("a second press cancels the pending collapse until the mouse is released", async ({
  page,
}) => {
  const point = await mountEditor(page);
  await page.mouse.click(point.x, point.y);
  await page.waitForTimeout(40);
  await page.mouse.down({ clickCount: 2 });
  await page.waitForTimeout(350);
  await expect(page.locator(".cm-content")).toContainText(
    "[[Library|Libraries]]",
  );
  await page.mouse.up({ clickCount: 2 });
  await expect.poll(() => selectedText(page)).toBe("install");
  await page.keyboard.down("Control");
  await expect(page.locator(".cm-content")).toContainText(
    "[[Library|Libraries]]",
  );
  await page.keyboard.up("Control");
});

for (const wiki of [true, false]) {
  test(`Alt-click immediately reveals ${wiki ? "wiki" : "Markdown"} link source`, async ({
    page,
  }) => {
    await mountEditor(page, wiki);
    for (let attempt = 0; attempt < 3; attempt++) {
      await page.evaluate(() => {
        const view = (globalThis as any).view;
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      });
      await page
        .locator(".cm-content a")
        .filter({ hasText: "Libraries" })
        .click({ modifiers: ["Alt"] });
      await expect
        .poll(() => page.locator(".cm-content").textContent(), { timeout: 150 })
        .toContain(wiki ? "[[Library|Libraries]]" : "[Libraries](Library)");
    }
  });
}

test("Alt press reveals wiki source even with an earlier collapse pending", async ({
  page,
}) => {
  await page.setViewportSize({ width: 2000, height: 800 });
  const point = await mountEditor(
    page,
    true,
    "Look at the [Libraries](Long/Example/Library/With/A/Hidden/Path) then [[Library|Libraries]] you can install.",
  );
  await page.mouse.click(point.x, point.y);
  const link = page.locator(".cm-content a.sb-wiki-link");
  const box = await link.boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(350);
  await expect(page.locator(".cm-content")).toContainText(
    "[[Library|Libraries]]",
  );
  await page.mouse.up();
  await page.keyboard.up("Alt");
  await expect(page.locator(".cm-content")).toContainText(
    "[[Library|Libraries]]",
  );
});

test("keyboard movement delays collapse until the cursor pauses", async ({
  page,
}) => {
  await mountEditor(page);
  await page.evaluate(() => {
    const view = (globalThis as any).view;
    const end = view.state.doc.toString().indexOf("]]") + 2;
    view.dispatch({ selection: { anchor: end } });
  });
  await page.keyboard.press("ArrowRight");
  expect(await page.locator(".cm-content").textContent()).toContain(
    "[[Library|Libraries]]",
  );
  await page.waitForTimeout(40);
  await page.keyboard.press("Shift+ArrowRight");
  await page.waitForTimeout(40);
  expect(await page.locator(".cm-content").textContent()).toContain(
    "[[Library|Libraries]]",
  );
  await expect(page.locator(".cm-content")).not.toContainText("[[Library|");
  expect(await selectedText(page)).toBe("y");
});

test("typing during a keyboard preview delay applies immediately", async ({
  page,
}) => {
  await mountEditor(page);
  await page.evaluate(() => {
    const view = (globalThis as any).view;
    view.dispatch({
      selection: { anchor: view.state.doc.toString().indexOf("]]") + 2 },
    });
  });
  await page.keyboard.press("ArrowRight");
  expect(await page.locator(".cm-content").textContent()).toContain(
    "[[Library|Libraries]]",
  );
  await page.keyboard.type("X");
  expect(await page.locator(".cm-content").textContent()).not.toContain(
    "[[Library|",
  );
  expect(
    await page.evaluate(() => (globalThis as any).view.state.doc.toString()),
  ).toContain("]] Xyou");
});

for (const wiki of [true, false]) {
  test(`keyboard entry reveals ${wiki ? "wiki" : "Markdown"} source after pausing`, async ({
    page,
  }) => {
    await mountEditor(page, wiki);
    await page.evaluate((wiki) => {
      const view = (globalThis as any).view;
      const end = wiki
        ? view.state.doc.toString().indexOf("]]") + 2
        : view.state.doc.toString().indexOf(")") + 1;
      view.dispatch({ selection: { anchor: end + 1 } });
    }, wiki);
    await expect(page.locator(".cm-content a")).toHaveCount(1);
    await page.keyboard.press("ArrowLeft");
    expect(await page.locator(".cm-content").textContent()).not.toContain(
      wiki ? "[[Library|" : "[Libraries](",
    );
    await expect(page.locator(".cm-content")).toContainText(
      wiki ? "[[Library|Libraries]]" : "[Libraries](Library)",
    );
  });
}

for (const initialCursor of ["plain text", "another wiki link"]) {
  test(`Alt press reveals a wiki link from ${initialCursor} before release`, async ({
    page,
  }) => {
    await mountEditor(
      page,
      true,
      "Open [[Library|Libraries]] and [[Reference|Reference]] you can install.",
    );
    if (initialCursor === "plain text") {
      await page.evaluate(() => {
        const view = (globalThis as any).view;
        view.dispatch({ selection: { anchor: view.state.doc.length } });
      });
    }
    const box = await page
      .locator(".cm-content a.sb-wiki-link")
      .filter({ hasText: "Reference" })
      .boundingBox();
    await page.keyboard.down("Alt");
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await expect(page.locator(".cm-content")).toContainText(
      "[[Reference|Reference]]",
      { timeout: 150 },
    );
    await page.mouse.up();
    await page.keyboard.up("Alt");
    await expect(page.locator(".cm-content")).toContainText(
      "[[Reference|Reference]]",
    );
    await expect(page.locator(".cm-content")).not.toContainText("[[Library|");
  });
}

import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

async function mountEditor(
  page: import("@playwright/test").Page,
  android = true,
) {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../client/", import.meta.url)),
      contents: `
        import { EditorState } from "@codemirror/state";
        import { EditorView, keymap } from "@codemirror/view";
        import { defaultKeymap } from "@codemirror/commands";
        import { androidInputSelection } from "./codemirror/editing/android_input.ts";
        Object.defineProperty(navigator, "userAgent", { value: ${JSON.stringify(android ? "Mozilla/5.0 (Android 17; Mobile)" : "Mozilla/5.0 (Macintosh)")} });
        const view = new EditorView({
          parent: document.body,
          state: EditorState.create({ doc: "H", selection: { anchor: 1 }, extensions: [androidInputSelection(), keymap.of(defaultKeymap)] }),
        });
        globalThis.view = view;
        view.focus();
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    logLevel: "silent",
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
}

test("Android typing keeps its cursor when the keyboard reports a stale DOM selection", async ({
  page,
}) => {
  await mountEditor(page);
  await page.keyboard.type("e");
  await page.evaluate(() => {
    const view = (globalThis as any).view;
    const pos = view.domAtPos(1);
    document.getSelection()!.collapse(pos.node, pos.offset);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", keyCode: 76, bubbles: true }),
    );
  });
  await page.keyboard.type("l");
  expect(
    await page.evaluate(() => (globalThis as any).view.state.doc.toString()),
  ).toBe("Hel");
});

test("Android typing follows a caret moved by touch", async ({ page }) => {
  await mountEditor(page);
  await page.keyboard.type("e");
  await page.evaluate(() => {
    const view = (globalThis as any).view;
    view.contentDOM.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    const pos = view.domAtPos(1);
    document.getSelection()!.collapse(pos.node, pos.offset);
  });
  await page.keyboard.type("l");
  expect(
    await page.evaluate(() => (globalThis as any).view.state.doc.toString()),
  ).toBe("Hle");
});

test("desktop typing follows the native caret", async ({ page }) => {
  await mountEditor(page, false);
  await page.keyboard.type("e");
  await page.evaluate(() => {
    const view = (globalThis as any).view;
    const pos = view.domAtPos(1);
    document.getSelection()!.collapse(pos.node, pos.offset);
  });
  await page.keyboard.type("l");
  expect(
    await page.evaluate(() => (globalThis as any).view.state.doc.toString()),
  ).toBe("Hle");
});

test("Android typing replaces a native selection before it has synchronized", async ({
  page,
}) => {
  await mountEditor(page);
  await page.keyboard.type("e");
  await page.evaluate(() => {
    const view = (globalThis as any).view;
    const from = view.domAtPos(0);
    const to = view.domAtPos(2);
    document
      .getSelection()!
      .setBaseAndExtent(from.node, from.offset, to.node, to.offset);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", keyCode: 76, bubbles: true }),
    );
  });
  await page.keyboard.type("l");
  expect(
    await page.evaluate(() => (globalThis as any).view.state.doc.toString()),
  ).toBe("l");
});

test("Android typing waits for pending native text before restoring its caret", async ({
  page,
}) => {
  await mountEditor(page);
  await page.keyboard.type("e");
  await page.evaluate(() => {
    const view = (globalThis as any).view;
    const pos = view.domAtPos(2);
    pos.node.nodeValue += "l";
    document.getSelection()!.collapse(pos.node, 3);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "o", keyCode: 79, bubbles: true }),
    );
  });
  await page.keyboard.type("o");
  expect(
    await page.evaluate(() => (globalThis as any).view.state.doc.toString()),
  ).toBe("Helo");
});

test("Android typing preserves a pending text node at an element caret", async ({
  page,
}) => {
  await mountEditor(page);
  await page.keyboard.type("e");
  await page.evaluate(() => {
    const view = (globalThis as any).view;
    const line = view.contentDOM.querySelector(".cm-line");
    line.append(document.createTextNode("l"));
    document.getSelection()!.collapse(line, line.childNodes.length);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "o", keyCode: 79, bubbles: true }),
    );
  });
  await page.keyboard.type("o");
  expect(
    await page.evaluate(() => (globalThis as any).view.state.doc.toString()),
  ).toBe("Helo");
});

test("Android typing keeps the caret after a keymap deletion", async ({
  page,
}) => {
  await mountEditor(page);
  await page.keyboard.type("e");
  await page.keyboard.press("Backspace");
  await page.evaluate(() => {
    const view = (globalThis as any).view;
    const pos = view.domAtPos(0);
    document.getSelection()!.collapse(pos.node, pos.offset);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "e", keyCode: 69, bubbles: true }),
    );
  });
  await page.keyboard.type("e");
  expect(
    await page.evaluate(() => (globalThis as any).view.state.doc.toString()),
  ).toBe("He");
});

test("Android typing follows a native caret after a pause", async ({
  page,
}) => {
  await mountEditor(page);
  await page.keyboard.type("e");
  await page.evaluate(() => {
    const view = (globalThis as any).view;
    const now = Date.now;
    Date.now = () => now() + 1000;
    const pos = view.domAtPos(1);
    document.getSelection()!.collapse(pos.node, pos.offset);
    view.contentDOM.dispatchEvent(
      new KeyboardEvent("keydown", { key: "l", keyCode: 76, bubbles: true }),
    );
    Date.now = now;
  });
  await page.keyboard.type("l");
  expect(
    await page.evaluate(() => (globalThis as any).view.state.doc.toString()),
  ).toBe("Hle");
});

import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

for (const nested of [false, true]) {
  test(`Alt-click reveals widget source${nested ? " through nested content handlers" : ""}`, async ({
    page,
  }) => {
    const bundle = await build({
      stdin: {
        resolveDir: fileURLToPath(new URL("../../client/", import.meta.url)),
        contents: `
          import { EditorState } from "@codemirror/state";
          import { Decoration, EditorView, WidgetType } from "@codemirror/view";
          import { decoratorStateField, isCursorInRange, invisibleDecoration } from "./codemirror/util.ts";
          import { attachWidgetEventHandlers } from "./codemirror/widgets/widget_util.ts";
          const source = '$' + '{1 + 2}';
          const doc = 'Before ' + source + ' after';
          let view;
          globalThis.navigations = 0;
          const client = {
            get editorView() { return view; },
            focus() { view.focus(); },
            navigate() { globalThis.navigations++; },
          };
          class FixtureWidget extends WidgetType {
            toDOM() {
              const host = document.createElement('span');
              const content = document.createElement('span');
              content.innerHTML = '<a href="#" data-ref="Other">Rendered value</a>';
              host.append(content);
              if (${nested}) attachWidgetEventHandlers(content, client);
              attachWidgetEventHandlers(host, client, source);
              return host;
            }
            ignoreEvent() { return true; }
          }
          const decorations = decoratorStateField(state => isCursorInRange(state, [7, 15])
            ? Decoration.none
            : Decoration.set([
                Decoration.widget({ widget: new FixtureWidget() }).range(7),
                invisibleDecoration.range(7, 15),
              ]));
          view = new EditorView({ parent: document.body, state: EditorState.create({ doc, extensions: [decorations] }) });
          globalThis.view = view;
        `,
      },
      bundle: true,
      write: false,
      format: "iife",
      logLevel: "silent",
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByText("Rendered value", { exact: true }).click();
    expect(await page.evaluate(() => (globalThis as any).navigations)).toBe(1);
    await expect(
      page.getByText("Rendered value", { exact: true }),
    ).toBeVisible();
    await page
      .getByText("Rendered value", { exact: true })
      .click({ modifiers: ["Alt"] });
    await expect(page.locator(".cm-content")).toContainText("${1 + 2}");
    expect(
      await page.evaluate(
        () => (globalThis as any).view.state.selection.main.anchor,
      ),
    ).toBe(7);
    expect(await page.evaluate(() => (globalThis as any).navigations)).toBe(1);
    await page.keyboard.type("X");
    expect(
      await page.evaluate(() => (globalThis as any).view.state.doc.toString()),
    ).toBe("Before X${1 + 2} after");
  });
}

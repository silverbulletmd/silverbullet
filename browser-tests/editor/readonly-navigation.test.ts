import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("read-only keyboard navigation steps over links and through widget controls", async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../client/", import.meta.url)),
      contents: `
        import { defaultKeymap } from "@codemirror/commands";
        import { EditorState } from "@codemirror/state";
        import { Decoration, drawSelection, EditorView, keymap, runScopeHandlers, WidgetType } from "@codemirror/view";
        import { decoratorStateField, isReadOnlyCursorAt, LinkWidget, readOnlyCursorActive, readOnlyCursorVisible } from "./codemirror/util.ts";
        import { readOnlyWidgetLinks } from "./codemirror/readonly_widget_links.ts";
        import { attachWidgetEventHandlers } from "./codemirror/widgets/widget_util.ts";
        const line1 = 'Start [[Page]] mid';
        const widgetSource = '$' + '{widget}';
        const doc = line1 + '\\n' + widgetSource + '\\nEnd';
        const linkFrom = 6;
        const linkTo = 14;
        const widgetFrom = line1.length + 1;
        const widgetTo = widgetFrom + widgetSource.length;
        let view;
        globalThis.navigations = [];
        globalThis.buttonClicks = 0;
        const client = {
          get editorView() { return view; },
          focus() {},
          navigate(ref) { globalThis.navigations.push(ref.path); },
        };
        class FixtureWidget extends WidgetType {
          toDOM() {
            const host = document.createElement('span');
            host.innerHTML = '<a href="#" data-ref="One">One</a> <a href="#" data-ref="Two">Two</a> <button>Btn</button>';
            host.querySelector('button').addEventListener('click', () => globalThis.buttonClicks++);
            attachWidgetEventHandlers(host, client, widgetSource);
            return host;
          }
          ignoreEvent() { return true; }
        }
        const decorations = decoratorStateField((state) => Decoration.set([
          Decoration.replace({
            widget: new LinkWidget({
              text: 'Page',
              title: 'Page',
              href: 'Page',
              cssClass: 'sb-wiki-link' + (isReadOnlyCursorAt(state, linkFrom, linkTo) ? ' sb-link-cursor' : ''),
              from: linkFrom,
              callback: () => {},
            }),
          }).range(linkFrom, linkTo),
          Decoration.replace({ widget: new FixtureWidget() }).range(widgetFrom, widgetTo),
        ]));
        view = new EditorView({
          parent: document.body,
          state: EditorState.create({
            doc,
            extensions: [
              decorations,
              drawSelection(),
              keymap.of(defaultKeymap),
              EditorView.editable.of(false),
              EditorState.readOnly.of(true),
              readOnlyCursorActive,
              readOnlyCursorVisible,
              readOnlyWidgetLinks,
            ],
          }),
        });
        // Like the client: keys reach the unfocused read-only editor this way
        globalThis.addEventListener('keydown', (ev) => {
          if (!view.hasFocus && runScopeHandlers(view, ev, 'editor')) ev.preventDefault();
        });
        globalThis.view = view;
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    logLevel: "silent",
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const head = () =>
    page.evaluate(() => (globalThis as any).view.state.selection.main.head);
  const highlighted = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".sb-link-cursor")].map(
        (e) => e.textContent,
      ),
    );
  const setCursor = (pos: number) =>
    page.evaluate(
      (pos) =>
        (globalThis as any).view.dispatch({ selection: { anchor: pos } }),
      pos,
    );

  // A moved cursor is shown although the editor never has focus
  await setCursor(5);
  await expect(page.locator(".cm-editor")).toHaveClass(/sb-readonly-cursor/);

  // A rendered link takes one step and is highlighted while the cursor is on it
  await page.keyboard.press("ArrowRight");
  expect(await head()).toBe(6);
  expect(await highlighted()).toEqual(["Page"]);
  await page.keyboard.press("ArrowRight");
  expect(await head()).toBe(14);
  expect(await highlighted()).toEqual([]);

  // Moving down onto the widget steps through its links and button
  await setCursor(18);
  for (const label of ["One", "Two", "Btn"]) {
    await page.keyboard.press("ArrowDown");
    await expect.poll(highlighted).toEqual([label]);
  }
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => (globalThis as any).buttonClicks)).toBe(1);

  // Past the last control the cursor moves on
  await page.keyboard.press("ArrowDown");
  await expect.poll(highlighted).toEqual([]);
  expect(await head()).toBeGreaterThan(29);

  // Moving up enters from the last control
  await page.keyboard.press("ArrowUp");
  await expect.poll(highlighted).toEqual(["Btn"]);
  await page.keyboard.press("ArrowUp");
  await expect.poll(highlighted).toEqual(["Two"]);
  await page.keyboard.press("ControlOrMeta+Enter");
  expect(await page.evaluate(() => (globalThis as any).navigations)).toEqual([
    "Two.md",
  ]);

  // The source behind links and widgets is never revealed
  await expect(page.locator(".cm-content")).not.toContainText("[[");
  await expect(page.locator(".cm-content")).not.toContainText("${");
});

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

test("Alt-click reveals the source of a read-only wiki link and widget until the cursor moves", async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../client/", import.meta.url)),
      contents: `
        import { defaultKeymap } from "@codemirror/commands";
        import { EditorState } from "@codemirror/state";
        import { Decoration, drawSelection, EditorView, keymap, runScopeHandlers, WidgetType } from "@codemirror/view";
        import { extendedMarkdownLanguage } from "./markdown_parser/parser.ts";
        import { cleanWikiLinkPlugin } from "./codemirror/syntax/wiki_link.ts";
        import { decoratorStateField, isCursorInRange, invisibleDecoration, readOnlyCursorActive, readOnlyCursorVisible, readOnlyReveal } from "./codemirror/util.ts";
        import { readOnlyWidgetLinks } from "./codemirror/readonly_widget_links.ts";
        import { attachWidgetEventHandlers } from "./codemirror/widgets/widget_util.ts";
        const widgetSource = '$' + '{1 + 2}';
        const doc = 'Link [[Page]] end\\n\\n' + widgetSource + '\\n\\nLast';
        const widgetFrom = doc.indexOf(widgetSource);
        const widgetTo = widgetFrom + widgetSource.length;
        let view;
        const client = {
          get editorView() { return view; },
          focus() {},
          config: { get: (_key, fallback) => fallback },
          currentPath: () => "Current.md",
          currentName: () => "Current",
          clientSystem: { allKnownFiles: new Set(["Page.md"]), knownFilesLoaded: true },
          fullSyncCompleted: true,
          ui: { viewState: { uiOptions: {}, allPages: [] } },
          navigate() {},
          dispatchClickEvent: async () => {},
        };
        class FixtureWidget extends WidgetType {
          toDOM() {
            const host = document.createElement('span');
            host.textContent = 'Rendered value';
            attachWidgetEventHandlers(host, client, widgetSource);
            return host;
          }
          ignoreEvent() { return true; }
        }
        const widgetDecorations = decoratorStateField((state) =>
          isCursorInRange(state, [widgetFrom, widgetTo])
            ? Decoration.none
            : Decoration.set([
                Decoration.replace({ widget: new FixtureWidget() }).range(widgetFrom, widgetTo),
              ]));
        view = new EditorView({
          parent: document.body,
          state: EditorState.create({
            doc,
            extensions: [
              extendedMarkdownLanguage,
              cleanWikiLinkPlugin(client),
              widgetDecorations,
              drawSelection(),
              keymap.of(defaultKeymap),
              EditorView.editable.of(false),
              EditorState.readOnly.of(true),
              readOnlyCursorActive,
              readOnlyCursorVisible,
              readOnlyReveal,
              readOnlyWidgetLinks,
            ],
          }),
        });
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

  const content = page.locator(".cm-content");
  const head = () =>
    page.evaluate(() => (globalThis as any).view.state.selection.main.head);

  // Rendered: no source, and a plain click doesn't reveal it
  await expect(content).not.toContainText("[[");
  await expect(content).not.toContainText("${");
  await page.locator("a.sb-wiki-link").click({ position: { x: 3, y: 3 } });
  await expect(content).not.toContainText("[[");

  // Alt-click on the link shows its source
  await page
    .locator("a.sb-wiki-link")
    .click({ modifiers: ["Alt"], position: { x: 3, y: 3 } });
  await expect(content).toContainText("[[Page]]");
  await expect(page.locator("a.sb-wiki-link")).toHaveCount(0);

  // The next arrow key steps off the source one character and renders it again
  const revealedHead = await head();
  await page.keyboard.press("ArrowRight");
  expect(await head()).toBe(revealedHead + 1);
  await expect(content).not.toContainText("[[");
  await expect(page.locator("a.sb-wiki-link")).toBeVisible();
  // ... without getting stuck inside the hidden source
  await page.keyboard.press("ArrowRight");
  expect(await head()).toBeGreaterThan(revealedHead + 1);

  // Alt-click on the widget shows its source
  await page
    .getByText("Rendered value")
    .click({ modifiers: ["Alt"], position: { x: 3, y: 3 } });
  await expect(content).toContainText("\${1 + 2}");
  await expect(page.getByText("Rendered value")).toHaveCount(0);
  await expect(content).not.toContainText("[[");

  // The next arrow key renders the widget again and the cursor keeps moving
  const widgetHead = await head();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByText("Rendered value")).toBeVisible();
  await expect(content).not.toContainText("\${1 + 2}");
  const afterWidget = await head();
  expect(afterWidget).not.toBe(widgetHead);
  await page.keyboard.press("ArrowDown");
  expect(await head()).toBeGreaterThan(afterWidget);
});

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, type Page, test } from "@playwright/test";
import { build } from "esbuild";

const stressTest = readFileSync("dev-docs/Outline Stress Test.md", "utf8");

// Quotes, and a quote inside a padded ordered item, which the stress test
// doesn't have.
const quotes = `
> A quote line
> > A nested quote that runs long enough to wrap onto a second visual row in the editor column
> * A list inside a quote that also runs long enough to wrap onto another visual row
>   * Nested list inside a quote

1. One
   > A quote inside a padded ordered item, long enough to wrap onto another row
10. Ten

* [TODO] A custom state task that wraps onto a second row in the narrow column, with more words

* An outer item
  > * A list in a quote in a list, long enough to wrap onto another row in the column
  >   Its continuation paragraph, also long enough to wrap onto another visual row
`;

async function mountEditor(page: Page, doc: string, width: number) {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../client/", import.meta.url)),
      contents: `
        import { EditorState, Prec } from "@codemirror/state";
        import { EditorView } from "@codemirror/view";
        import { forceParsing } from "@codemirror/language";
        import { buildExtendedMarkdownLanguage } from "./markdown_parser/parser.ts";
        import { listIndentPlugin } from "./codemirror/editing/list_indent.ts";
        import { blockquotePlugin } from "./codemirror/syntax/block_quote.ts";
        import { hideHeaderMarkPlugin } from "./codemirror/syntax/hide_mark.ts";
        import { lineWrapper } from "./codemirror/syntax/line_wrapper.ts";
        import { listBulletPlugin } from "./codemirror/syntax/list.ts";
        import { taskListPlugin } from "./codemirror/syntax/task.ts";
        let view;
        // Same plugins and order as cleanModePlugins, and the line classes
        // the layout CSS keys off.
        view = new EditorView({
          // #sb-editor: the editor font rule (colors.scss) is scoped to it.
          parent: document.querySelector("#sb-editor"),
          state: EditorState.create({
            doc: globalThis.doc,
            extensions: [
              buildExtendedMarkdownLanguage(),
              EditorView.lineWrapping,
              lineWrapper([
                { selector: "ATXHeading1", class: "sb-line-h1" },
                { selector: "ATXHeading2", class: "sb-line-h2" },
                { selector: "ListItem", class: "sb-line-li", nesting: true },
                { selector: "Blockquote", class: "sb-line-blockquote", nesting: true },
                { selector: "Task", class: "sb-line-task" },
                { selector: "FencedCode", class: "sb-line-fenced-code" },
              ]),
              blockquotePlugin(),
              hideHeaderMarkPlugin(),
              taskListPlugin({ onCheckboxClick: () => {}, getView: () => view }),
              listBulletPlugin(),
              Prec.lowest(listIndentPlugin()),
            ],
          }),
        });
        // The parser works through a long document in time slices; measure
        // only once every line has its decorations.
        forceParsing(view, view.state.doc.length, 5000);
        globalThis.view = view;
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    logLevel: "silent",
  });
  await page.route("http://layout.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><head></head><body><div id="sb-main" style="width:${width}px"><div id="sb-editor"></div></div></body></html>`,
    }),
  );
  await page.goto("http://layout.test/");
  // main.css is the space client's stylesheet (app.css is the dashboard's).
  await page.addStyleTag({ path: "client_bundle/client/.client/main.css" });
  await page.addStyleTag({
    // The editor grows to its content, so every line is rendered and
    // measurable; the app's shell would otherwise clip it to the window.
    content: `:root { --editor-font: Georgia, "Times New Roman", serif; --editor-monospace-font: Menlo, "DejaVu Sans Mono", monospace; }
      #sb-main, #sb-editor, #sb-main .cm-editor { height: auto !important; overflow: visible !important; position: static !important; }`,
  });
  await page.evaluate((doc) => {
    (globalThis as any).doc = doc;
  }, doc);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
}

type Row = { n: number; text: string; shift: number; hang: number | null };

/**
 * For every line opening with block markup: how far the text after the
 * markup moves when the cursor enters it, and how far the first wrapped row
 * starts from the first row's text. Both must be zero.
 */
function measure(page: Page): Promise<Row[]> {
  return page.evaluate(() => {
    const view = (globalThis as any).view;
    const doc = view.state.doc;
    const rows: Row[] = [];
    for (let n = 1; n <= doc.lines; n++) {
      const line = doc.line(n);
      const t: string = line.text;
      let markerFrom: number;
      let contentOff: number;
      let m: RegExpExecArray | null;
      // Leading spaces may come before a `>`: a quote inside a list item.
      if ((m = /^(\s*(?:> ?)*)(\s*)([-*+]|\d+[.)]) (\[[^\]]*\] )?/.exec(t))) {
        const pre = m[1].length + m[2].length;
        markerFrom = m[4] ? pre + m[3].length + 2 : pre;
        contentOff = m[0].length;
      } else if ((m = /^(\s*(?:> ?)+\s*)/.exec(t))) {
        // Content starts after any item indent that follows the `>`.
        markerFrom = m[0].indexOf(">");
        contentOff = m[0].length;
      } else {
        continue;
      }
      const cpos = line.from + contentOff;
      view.dispatch({ selection: { anchor: doc.length } });
      const a = view.coordsAtPos(cpos);
      let hang: number | null = null;
      for (let p = cpos; p < line.to; p++) {
        const c = view.coordsAtPos(p, 1);
        if (c && a && c.top > a.top + 2) {
          hang = c.left - a.left;
          break;
        }
      }
      view.dispatch({ selection: { anchor: line.from + markerFrom } });
      const b = view.coordsAtPos(cpos);
      rows.push({ n, text: t.slice(0, 40), shift: b.left - a.left, hang });
    }
    return rows;
  });
}

test("block markup never moves text on reveal, in a proportional font", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 6000 });
  await mountEditor(page, `${stressTest}\n${quotes}`, 560);
  const rows = await measure(page);
  expect(rows.length).toBeGreaterThan(60);
  // The quotes inside list items are measured too, not skipped.
  expect(
    rows.filter((r) => /^\s+>/.test(r.text)).length,
  ).toBeGreaterThanOrEqual(3);
  const off = rows.filter(
    (r) =>
      Math.abs(r.shift) > 0.5 || (r.hang !== null && Math.abs(r.hang) > 0.5),
  );
  expect(off).toEqual([]);
});

test("a long first word stays on the marker's row", async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 800 });
  await mountEditor(
    page,
    "* https://example.com/averyveryveryverylongpathwithoutanybreakopportunitiesatall/foo/bar/baz\n" +
      "* [ ] https://example.com/averyveryveryverylongpathwithoutanybreakopportunitiesatall/foo/bar\n",
    480,
  );
  const tops = await page.evaluate(() => {
    const view = (globalThis as any).view;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    return [1, 2].map((n) => {
      const line = view.state.doc.line(n);
      const start = line.from + line.text.indexOf("https");
      return [
        view.coordsAtPos(line.from, 1).top,
        view.coordsAtPos(start, 1).top,
      ];
    });
  });
  for (const [marker, word] of tops) expect(word).toBe(marker);
});

test("typing the first letter of an item under a paragraph doesn't move it", async ({
  page,
}) => {
  await page.setViewportSize({ width: 700, height: 800 });
  const cases = [
    "Grab bag:\n* ",
    "Grab bag:\n1. ",
    // Not `-`: under a paragraph that is a setext heading underline.
    "Grab bag:\n  + ",
    "* item\n  * ",
    "> Grab bag:\n> * ",
  ];
  await mountEditor(page, cases[0], 560);
  const shifts = await page.evaluate((cases) => {
    const view = (globalThis as any).view;
    return cases.map((doc) => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: doc },
        selection: { anchor: doc.length },
      });
      const before = view.coordsAtPos(doc.length).left;
      view.dispatch({
        changes: { from: doc.length, insert: "H" },
        selection: { anchor: doc.length + 1 },
      });
      return [doc, view.coordsAtPos(doc.length, 1).left - before];
    });
  }, cases);
  for (const [doc, shift] of shifts) {
    expect(Math.abs(shift as number), JSON.stringify(doc)).toBeLessThan(0.5);
  }
});

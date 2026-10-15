import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

type Box = { left: number; right: number };
type Layout = { direction: string; first: Box; mark: Box; stop: Box };

test("right-to-left excerpts read right to left with their highlights in place", async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(new URL("../../plug-api/ui/", import.meta.url)),
      contents: `
        import { h, render } from "preact";
        import { RowText } from "./row_text.tsx";
        const rows = {
          arabic: { text: "راجعت F-31 مع الفريق.", highlights: [[6, 10]] },
          english: { text: "Checked F-31 with the team.", highlights: [[8, 12]] },
        };
        for (const [id, description] of Object.entries(rows)) {
          render(h(RowText, { primary: "Notes/Valve", description }), document.getElementById(id));
        }
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    jsx: "automatic",
    jsxImportSource: "preact",
    logLevel: "silent",
  });
  await page.route("http://rows.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<meta charset="utf-8"><div class="sb-nav-row" style="width:420px"><div id="arabic"></div></div><div class="sb-nav-row" style="width:420px"><div id="english"></div></div>',
    }),
  );
  await page.goto("http://rows.test/");
  await page.addStyleTag({ path: "client_bundle/client/.client/app.css" });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });

  const layout = (id: string, first: string) =>
    page.evaluate(
      ([id, first]): Layout => {
        const el = document.querySelector(
          `#${id} .sb-nav-description-text`,
        ) as HTMLElement;
        const nodes = [...el.childNodes].flatMap((n) =>
          n.nodeType === Node.TEXT_NODE ? [n] : [...n.childNodes],
        );
        const box = (needle: string): Box => {
          const node = nodes.find((n) => n.textContent?.includes(needle))!;
          const at = node.textContent!.indexOf(needle);
          const range = document.createRange();
          range.setStart(node, at);
          range.setEnd(node, at + needle.length);
          const { left, right } = range.getBoundingClientRect();
          return { left, right };
        };
        return {
          direction: getComputedStyle(el).direction,
          first: box(first),
          mark: box("F-31"),
          stop: box("."),
        };
      },
      [id, first] as const,
    );

  const ar = await layout("arabic", "راجعت");
  expect(ar.direction).toBe("rtl");
  // Right to left: the first word rightmost, then the highlight, and the
  // full stop at the far left.
  expect(ar.mark.right).toBeLessThanOrEqual(ar.first.left + 0.5);
  expect(ar.stop.right).toBeLessThanOrEqual(ar.mark.left + 0.5);
  await expect(page.locator("#arabic mark")).toHaveText("F-31");

  const en = await layout("english", "Checked");
  expect(en.direction).toBe("ltr");
  expect(en.first.right).toBeLessThanOrEqual(en.mark.left + 0.5);
  expect(en.mark.right).toBeLessThanOrEqual(en.stop.left + 0.5);
});

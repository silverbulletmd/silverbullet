// @vitest-environment happy-dom
import { expect, test } from "vitest";
import { PageScopes } from "../space_lua/page_scope.ts";
import { renderToText } from "@silverbulletmd/silverbullet/lib/tree";
import { parse } from "../markdown_parser/parse_tree.ts";
import { extendedMarkdownLanguage } from "../markdown_parser/parser.ts";
import {
  createRenderContext,
  evalDirectiveText,
  expandMarkdownStatic,
  renderMarkdown,
} from "./compose.ts";
import { buildTestEnv, testHost } from "./compose_test_env.ts";

const budget =
  "${salary = 500} raised: ${salary * (1 + increase / 100)} ${increase = 5}";

async function scopedContext(pages: Record<string, string>, pageName: string) {
  const t = await buildTestEnv(pages);
  const scopes = new PageScopes({
    readPageText: async (n) => (n in pages ? pages[n] : null),
    spaceEnv: () => t.env,
  });
  const host = testHost(t, { pageScopes: scopes });
  return createRenderContext(host, { hostPage: { name: pageName } });
}

async function render(pages: Record<string, string>, pageName: string) {
  return renderMarkdown(pages[pageName], await scopedContext(pages, pageName));
}

test("display cells see the whole page scope; assignments show a tag", async () => {
  const out = await render({ Budget: budget }, "Budget");
  const html = out.node.innerHTML;
  expect(html).toContain('class="sb-page-var-tag">salary<');
  expect(html).toContain("500");
  expect(html).toContain("525");
});

test("pages without definitions render as before", async () => {
  const out = await render({ Plain: "Two: ${1 + 1}" }, "Plain");
  expect(out.node.innerHTML).toContain("2");
  expect(out.node.innerHTML).not.toContain("sb-page-var");
});

test("transcluded pages evaluate in their own scope", async () => {
  const out = await render(
    { Budget: budget, Report: "![[Budget]] mine: ${salary}" },
    "Report",
  );
  const html = out.node.innerHTML;
  expect(html).toContain("525");
  // nil renders as an empty slot
  expect(html).toMatch(
    /mine: <span class="sb-slot"[^>]*><span><\/span><\/span>/,
  );
});

test("copying an assignment yields its value, not the name", async () => {
  const out = await render({ Budget: "Pay: ${salary = 500}" }, "Budget");
  expect(out.copyMarkdown).toBe("Pay: 500");
});

test("static expansion replaces an assignment with its value", async () => {
  const pages = { Budget: "Pay: ${salary = 500}" };
  const ctx = await scopedContext(pages, "Budget");
  const tree = await expandMarkdownStatic(
    parse(extendedMarkdownLanguage, pages.Budget),
    ctx,
  );
  expect(renderToText(tree)).toBe("Pay: 500");
});

test("evaluating an assignment's text yields its scope value", async () => {
  const pages = { Budget: "${salary = 500} ${increase = salary - 495}" };
  const ctx = await scopedContext(pages, "Budget");
  expect(await evalDirectiveText("salary = 500", ctx)).toBe(500);
  expect(await evalDirectiveText("increase + 1", ctx)).toBe(6);
});

test("rendering records the page scopes and transcluded files it read", async () => {
  const pages: Record<string, string> = {
    Budget: budget,
    Report: "![[Budget]] ${1 + 1}",
  };
  const t = await buildTestEnv(pages);
  const scopes = new PageScopes({
    readPageText: async (n) => (n in pages ? pages[n] : null),
    spaceEnv: () => t.env,
  });
  const read: string[] = [];
  const ctx = createRenderContext(testHost(t, { pageScopes: scopes }), {
    hostPage: { name: "Report" },
    track: (event) => read.push(event),
  });
  await renderMarkdown(pages.Report, ctx);
  expect(new Set(read)).toEqual(
    new Set(["file:changed:Budget.md", "pageScope:changed:Budget"]),
  );
});

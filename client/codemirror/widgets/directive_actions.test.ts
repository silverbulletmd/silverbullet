// @vitest-environment happy-dom
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { expect, test, vi } from "vitest";
import type { Client } from "../../client.ts";
import { createRenderContext } from "../../markdown_renderer/compose.ts";
import {
  buildTestEnv,
  testHost,
} from "../../markdown_renderer/compose_test_env.ts";
import { extendedMarkdownLanguage } from "../../markdown_parser/parser.ts";
import { newView } from "../../navigator/view_value.ts";
import { evalExpression } from "../../space_lua/eval.ts";
import { parseExpressionString } from "../../space_lua/parse.ts";
import { LuaStackFrame, type LuaTable } from "../../space_lua/runtime.ts";
import { activeWidgets, type DomWidget } from "./code_widget.ts";
import {
  bakeDirective,
  copyValue,
  directiveAtWidget,
  directiveCacheKey,
  liveToggle,
  reloadDirective,
  setDirectiveLive,
} from "./directive_actions.ts";

function fakeClient(doc: string, extra: Record<string, unknown> = {}) {
  let state = EditorState.create({
    doc,
    extensions: [extendedMarkdownLanguage],
  });
  ensureSyntaxTree(state, state.doc.length, 5000);
  const dispatch = vi.fn(
    (tr: { changes: { from: number; to: number; insert: string } }) => {
      state = state.update({ changes: tr.changes }).state;
      ensureSyntaxTree(state, state.doc.length, 5000);
    },
  );
  const client = {
    get editorView() {
      return {
        state,
        dispatch,
        posAtDOM: (dom: HTMLElement) => Number(dom.dataset.pos),
      };
    },
    isReadOnlyMode: () => false,
    focus: () => {},
    ui: { flashNotification: vi.fn() },
    currentPageMeta: () => ({ name: "Projects/Sketchbook" }),
    widgetCache: { invalidatePrewarm: vi.fn() },
    ...extra,
  } as unknown as Client;
  return { client, dispatch, doc: () => state.doc.toString() };
}

const at = (pos: number) => {
  const dom = document.createElement("span");
  dom.dataset.pos = String(pos);
  return dom;
};

test("a widget finds its own ${…} inside formatting, links and next to another", () => {
  const doc = "**${a()}** [${b()}](https://example.com) ${c()}${d()}";
  const { client } = fakeClient(doc);
  for (const expr of ["a()", "b()", "c()", "d()"]) {
    const t = directiveAtWidget(client, at(doc.indexOf(`\${${expr}}`)), expr);
    expect(t?.expr).toBe(expr);
    expect(doc.slice(t!.from, t!.to)).toBe(`\${${expr}}`);
  }
  expect(
    directiveAtWidget(client, at(doc.indexOf("${a()}")), "b()"),
  ).toBeUndefined();
});

test("Bake and Make live rewrite exactly the widget's ${…}", async () => {
  const t = await buildTestEnv();
  const doc = "**${q()}**${r()}";
  const { client, doc: text } = fakeClient(doc, {
    clientSystem: { spaceLuaEnv: t.sle },
  });
  // Make live first: the baked region's closing line swallows what follows it
  const r = directiveAtWidget(client, at(doc.indexOf("${r()}")), "r()")!;
  setDirectiveLive(client, r, "makeLive");
  expect(text()).toBe("**${q()}**${widget.live(r())}");
  const target = directiveAtWidget(client, at(2), "q()")!;
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  await bakeDirective(client, target, "**done**", ctx);
  expect(text()).toBe(
    "**<!--#lua q() -->\n**done**\n<!--/lua-->**${widget.live(r())}",
  );
});

test("the menu and the palette copy the same text: rows for a list view, the text of a Lua error", async () => {
  const t = await buildTestEnv();
  const spec = await evalExpression(
    parseExpressionString(
      "{ source = function(ctx) return {{ name = ctx.dock }} end }",
    ),
    t.env,
    LuaStackFrame.createWithGlobalEnv(t.env),
  );
  const localSyscall = vi.fn();
  const { client } = fakeClient("", {
    clientSystem: { spaceLuaEnv: t.sle, localSyscall },
  });
  // An explicit context: the default one needs a full client
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  await copyValue(client, newView(spec as LuaTable), ctx);
  const error = "**Lua error:** boom";
  await copyValue(client, error, ctx);
  expect(localSyscall.mock.calls).toEqual([
    ["editor.copyToClipboard", ["* inline"]],
    ["editor.copyToClipboard", [error]],
  ]);
});

test("Make live / Make static: one rule for the menu and the palette", () => {
  expect(liveToggle("q()")).toBe("makeLive");
  expect(liveToggle("widget.live(q())")).toBe("makeStatic");
  expect(
    liveToggle("widget.live(q(), {})", { live: false, kind: "markdown" }),
  ).toBe("makeStatic");
  expect(
    liveToggle("{ widget.live(q()), 1 }", { live: true, kind: "markdown" }),
  ).toBeUndefined();
  expect(
    liveToggle("widget.sandbox(s)", { live: false, kind: "sandbox" }),
  ).toBeUndefined();
  expect(liveToggle("v", { live: false, kind: "view" })).toBeUndefined();
});

test("Widget: Reload re-runs every copy of the expression on the page", async () => {
  const { client } = fakeClient("${q()} ${q()}");
  const key = directiveCacheKey("q()", "Projects/Sketchbook");
  const reloads = [vi.fn(async () => {}), vi.fn(async () => {})];
  const widgets = reloads.map(
    (reload) =>
      ({
        cacheKey: key,
        reload,
        invalidatePrewarm() {},
        renderContent: async () => {},
      }) as DomWidget,
  );
  for (const w of widgets) activeWidgets.add(w);
  try {
    await reloadDirective(client, "q()");
    for (const reload of reloads) expect(reload).toHaveBeenCalledOnce();
    expect(client.widgetCache.invalidatePrewarm).toHaveBeenCalledWith(key);
  } finally {
    for (const w of widgets) activeWidgets.delete(w);
  }
});

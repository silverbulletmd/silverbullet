// @vitest-environment happy-dom
import { expect, test } from "vitest";
import {
  createRenderContext,
  renderValue,
} from "../../../markdown_renderer/compose.ts";
import {
  buildTestEnv,
  testHost,
} from "../../../markdown_renderer/compose_test_env.ts";
import { evalExpression } from "../../../space_lua/eval.ts";
import { parseExpressionString } from "../../../space_lua/parse.ts";
import { LuaStackFrame, luaValueToJS } from "../../../space_lua/runtime.ts";

async function contentValue(lua: string) {
  const t = await buildTestEnv();
  const sf = LuaStackFrame.createWithGlobalEnv(t.env);
  const v = await evalExpression(parseExpressionString(lua), t.env, sf);
  // luaHandle hands content results over as JS values (callLua → luaValueToJS)
  return { t, value: luaValueToJS(v, sf) };
}

test("a query-shaped result renders as a table, not blank", async () => {
  const { t, value } = await contentValue(
    '{ { name = "Alpha task", done = false }, { name = "Beta task", done = true } }',
  );
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const r = await renderValue(value, ctx);
  expect(r.empty).toBe(false);
  expect(r.node.querySelector("table")).not.toBeNull();
  expect(r.node.textContent).toContain("Beta task");
});

test("a fragment keeps its text and its widget", async () => {
  const { t, value } = await contentValue('"Status: " .. T.btn("Go")');
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const r = await renderValue(value, ctx);
  expect(r.node.textContent).toContain("Status:");
  expect(r.node.querySelector("button")?.textContent).toBe("Go");
});

test("an evaluate = false widget stays literal through the content path", async () => {
  const t = await buildTestEnv();
  const ctx = createRenderContext(testHost(t), { hostPage: { name: "Host" } });
  const r = await renderValue(
    { _isWidget: true, markdown: "${1+1} and ![[Some Page]]", evaluate: false },
    ctx,
  );
  expect(r.node.textContent).toContain("${1+1}");
  expect(r.node.textContent).not.toContain("2 and");
  expect(r.node.textContent).toContain("![[Some Page]]");
});

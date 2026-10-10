// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import type { Client } from "../../../client.ts";
import {
  createRenderContext,
  type RenderContext,
} from "../../../markdown_renderer/compose.ts";
import {
  buildTestEnv,
  testHost,
} from "../../../markdown_renderer/compose_test_env.ts";
import { evalExpression } from "../../../space_lua/eval.ts";
import { makeFragment } from "../../../space_lua/fragment.ts";
import { parseExpressionString } from "../../../space_lua/parse.ts";
import { LuaStackFrame, type LuaTable } from "../../../space_lua/runtime.ts";
import { newView } from "../../view_value.ts";

let ctx: RenderContext;
vi.mock("../../../markdown_renderer/compose_client.ts", () => ({
  liveContextForClient: () => ctx,
}));

const { renderContent } = await import("./content_view.tsx");

test("docked Copy copies what ⋯ Copy does, nested view rows included", async () => {
  const t = await buildTestEnv();
  ctx = createRenderContext(testHost(t, { mountView: () => () => {} }), {
    hostPage: { name: "Host" },
  });
  const spec = await evalExpression(
    parseExpressionString(
      "{ source = function(ctx) return {{ name = ctx.dock }} end }",
    ),
    t.env,
    LuaStackFrame.createWithGlobalEnv(t.env),
  );
  const localSyscall = vi.fn(async () => {});
  const client = {
    clientSystem: { localSyscall },
    ui: { flashNotification: vi.fn() },
  } as unknown as Client;
  const content = await renderContent(
    client,
    makeFragment(["Rows:\n\n", newView(spec as LuaTable)]),
    "Host",
  );
  expect(content.copy).toBeDefined();
  await content.copy!();
  expect(localSyscall).toHaveBeenCalledWith("editor.copyToClipboard", [
    "Rows:\n\n* inline",
  ]);
});

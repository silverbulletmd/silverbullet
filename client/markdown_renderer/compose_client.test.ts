// @vitest-environment happy-dom
import { BasenameIndex } from "@silverbulletmd/silverbullet/lib/resolve_path";
import { expect, test, vi } from "vitest";
import type { Client } from "../client.ts";
import { attachWidgetEventHandlers } from "../codemirror/widgets/widget_util.ts";
import { renderLuaExpression } from "../space_lua/render_widget.ts";
import {
  createRenderContext,
  portableMarkdown,
  renderValue,
} from "./compose.ts";
import {
  expressionToPortableMarkdown,
  liveContextForClient,
  renderHostForClient,
} from "./compose_client.ts";
import { buildTestEnv, type TestEnv, testHost } from "./compose_test_env.ts";

const sandbox = vi.hoisted(() => ({
  onMessage: undefined as ((m: any) => void) | undefined,
}));
vi.mock("../sandbox/widget_sandbox_iframe.ts", () => ({
  createWidgetSandboxIFrame: (_c: any, _k: string, _s: any, cb: any) => {
    sandbox.onMessage = cb;
    return document.createElement("iframe");
  },
}));

function sandboxClient(cachedHeight: number) {
  return {
    space: {},
    clientSystem: { spaceLuaEnv: {} },
    config: { get: (_k: string, d: unknown) => d },
    ui: { viewState: { allPages: [] } },
    widgetCache: { getCachedWidgetHeight: () => cachedHeight },
    currentName: () => "Host",
  } as any;
}

test("sandbox host reserves the cached height until the iframe attaches", async () => {
  const host = renderHostForClient(sandboxClient(320), { sandboxKey: "k" });
  const node = host.createSandbox!({ html: "<p>x</p>" } as any);
  expect(node.style.height).toBe("320px");
  await vi.waitFor(() => expect(node.querySelector("iframe")).toBeTruthy());
  expect(node.querySelector("iframe")!.style.height).toBe("320px");
  expect(node.style.height).toBe("");
});

test("sandbox host reserves 150px when nothing is cached", () => {
  const host = renderHostForClient(sandboxClient(0), { sandboxKey: "k" });
  expect(host.createSandbox!({ html: "" } as any).style.height).toBe("150px");
});

test("sandbox messages are forwarded with the iframe", async () => {
  const seen = vi.fn();
  const host = renderHostForClient(sandboxClient(0), {
    onSandboxMessage: seen,
  });
  const node = host.createSandbox!({ html: "" } as any);
  await vi.waitFor(() => expect(node.querySelector("iframe")).toBeTruthy());
  sandbox.onMessage!({ type: "blur" });
  expect(seen).toHaveBeenCalledWith(
    { type: "blur" },
    node.querySelector("iframe"),
  );
});

function fakeClient(t: TestEnv): Client {
  return {
    clientSystem: { spaceLuaEnv: t.sle, allKnownFiles: new BasenameIndex() },
    space: t.space,
    ui: { viewState: { current: { path: "Workshop.md" }, allPages: [] } },
    currentPageMeta: () => ({ name: "Workshop" }),
    currentName: () => "Workshop",
    config: { get: (_k: string, d: unknown) => d },
  } as unknown as Client;
}

const copy = async (client: Client, expr: string) =>
  portableMarkdown(
    await renderLuaExpression(client, expr),
    liveContextForClient(client),
  );

test("Bake text is the fragment's text", async () => {
  const t = await buildTestEnv();
  expect(
    await expressionToPortableMarkdown(
      fakeClient(t),
      '"Status: " .. T.md("**ok**")',
    ),
  ).toEqual({ ok: true, markdown: "Status: **ok**" });
});

test("Bake button text equals Baked Sections: Update text", async () => {
  const t = await buildTestEnv();
  const client = fakeClient(t);
  const expr = 'T.md("* [ ] Alpha task")';
  const widgetCtx = createRenderContext(testHost(t), {
    hostPage: { name: "Workshop" },
    sourcePage: "Workshop",
  });
  const viaWidget = await portableMarkdown(
    await renderLuaExpression(client, expr),
    widgetCtx,
  );
  const viaUpdate = await expressionToPortableMarkdown(client, expr);
  expect(viaUpdate).toEqual(viaWidget);
  expect(viaWidget.ok && viaWidget.markdown).toContain("Alpha task");
  expect(viaWidget.ok && viaWidget.markdown).not.toContain("[[");
});

test("a widget's unlinked task gets no reference, and its checkbox stays disabled", async () => {
  const t = await buildTestEnv();
  const client = fakeClient(t);
  const expr = 'T.md("* [ ] Alpha task")';
  const expected = { ok: true, markdown: "* [ ] Alpha task" };
  expect(await copy(client, expr)).toEqual(expected);
  expect(await expressionToPortableMarkdown(client, expr)).toEqual(expected);
  const { node } = await renderValue(
    await renderLuaExpression(client, expr),
    liveContextForClient(client),
  );
  attachWidgetEventHandlers(node, client);
  const box = node.querySelector("input[type=checkbox]")!;
  expect(box.hasAttribute("disabled")).toBe(true);
  expect(node.querySelector("[data-external-task-ref]")).toBeNull();
});

test("a transcluded page's task gets a reference at its real offset", async () => {
  const t = await buildTestEnv({
    "Projects/Sketchbook": "Intro\n\n* [ ] Alpha task",
  });
  const client = fakeClient(t);
  const expr = 'T.md("![[Projects/Sketchbook]]")';
  const expected = {
    ok: true,
    markdown: "Intro\n\n* [ ] [[Projects/Sketchbook@7]] Alpha task",
  };
  expect(await copy(client, expr)).toEqual(expected);
  expect(await expressionToPortableMarkdown(client, expr)).toEqual(expected);
});

test("a task that already has a reference keeps it", async () => {
  const t = await buildTestEnv();
  const client = fakeClient(t);
  const expr = 'T.md("* [ ] [[Projects/Sketchbook@4]] Alpha task")';
  const kept = {
    ok: true,
    markdown: "* [ ] [[Projects/Sketchbook@4]] Alpha task",
  };
  expect(await copy(client, expr)).toEqual(kept);
  expect(await expressionToPortableMarkdown(client, expr)).toEqual(kept);
});

test("Bake refuses a Lua error or timeout", async () => {
  const t = await buildTestEnv();
  const client = fakeClient(t);
  expect(
    (await expressionToPortableMarkdown(client, '"**Lua timeout:** slow"')).ok,
  ).toBe(false);
  expect((await expressionToPortableMarkdown(client, "nosuch.field")).ok).toBe(
    false,
  );
});

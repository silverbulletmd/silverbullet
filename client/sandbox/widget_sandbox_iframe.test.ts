// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { awaitRenderSettled } from "../codemirror/widgets/render_settle.ts";
import { createWidgetSandboxIFrame } from "./widget_sandbox_iframe.ts";

const frame = () => new Promise<void>((resolve) => setTimeout(resolve, 1));
const client = {} as any;

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test("a sandbox disposed before its iframe loads doesn't hold up render settling", async () => {
  const { dispose } = createWidgetSandboxIFrame(client, null, null);
  dispose();
  expect(await awaitRenderSettled({ nextFrame: frame, timeoutMs: 200 })).toBe(
    true,
  );
});

test("disposing a loaded sandbox removes its message listener", async () => {
  const add = vi.spyOn(globalThis, "addEventListener");
  const remove = vi.spyOn(globalThis, "removeEventListener");
  const { iframe, dispose } = createWidgetSandboxIFrame(client, null, null);
  document.body.append(iframe);
  iframe.onload?.(new Event("load"));
  await vi.waitFor(() =>
    expect(add.mock.calls.some(([type]) => type === "message")).toBe(true),
  );
  const listener = add.mock.calls.find(([type]) => type === "message")![1];
  dispose();
  expect(remove).toHaveBeenCalledWith("message", listener);
});

test("a sandbox disposed before its iframe loads never listens for messages", async () => {
  const add = vi.spyOn(globalThis, "addEventListener");
  const { iframe, dispose } = createWidgetSandboxIFrame(client, null, null);
  dispose();
  document.body.append(iframe);
  iframe.onload?.(new Event("load"));
  await frame();
  expect(add.mock.calls.some(([type]) => type === "message")).toBe(false);
});

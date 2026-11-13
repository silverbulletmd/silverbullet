// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { awaitRenderSettled } from "../codemirror/widgets/render_settle.ts";
import { createWidgetSandboxIFrame } from "./widget_sandbox_iframe.ts";

const frame = () => new Promise<void>((resolve) => setTimeout(resolve, 1));
const themeListeners = new Set<() => void>();
const client = {
  spaceTheme: {
    message: {
      scheme: "dark",
      page: "Library/Paper/Night",
      css: "<style>html{--root-color:#eee}</style>",
    },
    onChange(fn: () => void) {
      themeListeners.add(fn);
      return () => themeListeners.delete(fn);
    },
  },
} as any;

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

test("a loaded widget is sent the theme's CSS on each switch, until disposed", async () => {
  const { iframe, dispose } = createWidgetSandboxIFrame(client, null, null);
  document.body.append(iframe);
  iframe.onload?.(new Event("load"));
  await vi.waitFor(() => expect(themeListeners.size).toBe(1));
  const post = vi.spyOn(iframe.contentWindow!, "postMessage");
  for (const fn of themeListeners) fn();
  expect(post).toHaveBeenCalledWith({
    type: "theme",
    ...client.spaceTheme.message,
  });
  dispose();
  expect(themeListeners.size).toBe(0);
});

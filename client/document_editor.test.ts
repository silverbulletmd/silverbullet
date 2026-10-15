// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from "vitest";
import { IFrameDocumentEditor } from "./document_editor.ts";

const resolution = (callback: () => Promise<any>) =>
  ({
    kind: "plug",
    extension: "png",
    name: "Image Viewer",
    callback,
  }) as any;

const messageListeners = (spy: { mock: { calls: unknown[][] } }) =>
  spy.mock.calls.filter(([type]) => type === "message").map(([, fn]) => fn);

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

test("destroying a document editor removes its message listener", async () => {
  const add = vi.spyOn(globalThis, "addEventListener");
  const remove = vi.spyOn(globalThis, "removeEventListener");
  const editor = new IFrameDocumentEditor(document.body, {} as any, () => {});
  void editor.init(resolution(async () => ({ html: "<p>viewer</p>" })));
  await vi.waitFor(() => expect(messageListeners(add)).toHaveLength(1));
  await editor.destroy();
  expect(messageListeners(remove)).toEqual(messageListeners(add));
});

test("a document editor destroyed while loading never listens for messages", async () => {
  const add = vi.spyOn(globalThis, "addEventListener");
  const content = Promise.withResolvers<any>();
  const editor = new IFrameDocumentEditor(document.body, {} as any, () => {});
  const init = editor.init(resolution(() => content.promise));
  await editor.destroy();
  content.resolve({ html: "<p>viewer</p>" });
  await init;
  expect(messageListeners(add)).toHaveLength(0);
  expect(document.body.querySelector("iframe")).toBeNull();
});

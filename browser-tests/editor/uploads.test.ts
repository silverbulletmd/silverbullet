import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { build } from "esbuild";

test("page upload listeners follow page-to-text transitions and page rebuilds", async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(
        new URL("../../client/codemirror/", import.meta.url),
      ),
      contents: `
        import { EditorState } from "@codemirror/state";
        import { EditorView } from "@codemirror/view";
        import { documentExtension } from "./editor_paste.ts";

        globalThis.runUploadLifecycle = async () => {
          const listeners = new Set();
          const add = document.addEventListener.bind(document);
          const remove = document.removeEventListener.bind(document);
          document.addEventListener = (type, listener, options) => {
            if (type === "silverbullet:upload-files") listeners.add(listener);
            add(type, listener, options);
          };
          document.removeEventListener = (type, listener, options) => {
            if (type === "silverbullet:upload-files") listeners.delete(listener);
            remove(type, listener, options);
          };
          let writes = 0;
          let writeBarrier;
          const client = {
            currentPath: () => "Example.md",
            config: { get: (_key, fallback) => fallback },
            ui: { prompt: async () => "example.png", flashNotification: () => {} },
            space: {
              spacePrimitives: { getFileMeta: async () => { throw new Error("missing"); } },
              writeDocument: async () => { writes++; await writeBarrier; },
            },
          };
          globalThis.client = client;
          const pageState = () => EditorState.create({ doc: "page", extensions: documentExtension(client) });
          const upload = async () => {
            const file = { name: "example.png", type: "image/png", arrayBuffer: async () => new ArrayBuffer(0) };
            document.dispatchEvent(new CustomEvent("silverbullet:upload-files", { detail: { files: [file] } }));
            await new Promise(resolve => setTimeout(resolve, 0));
          };
          const initialState = pageState();
          const unmountedListeners = listeners.size;
          const view = new EditorView({ state: initialState, parent: document.body });
          client.editorView = view;
          try {
            await upload();
            const firstPage = { text: view.state.sliceDoc(), writes, listeners: listeners.size };
            view.setState(pageState());
            view.setState(pageState());
            const rebuiltListeners = listeners.size;
            view.setState(EditorState.create({ doc: "fn main() {}" }));
            await upload();
            const text = { text: view.state.sliceDoc(), writes, listeners: listeners.size };
            view.setState(pageState());
            await upload();
            const returnedPage = { text: view.state.sliceDoc(), writes, listeners: listeners.size };
            let releaseWrite;
            writeBarrier = new Promise(resolve => { releaseWrite = resolve; });
            await upload();
            view.setState(EditorState.create({ doc: "fn main() {}" }));
            releaseWrite();
            await new Promise(resolve => setTimeout(resolve, 0));
            const textAfterPendingUpload = view.state.sliceDoc();
            return { unmountedListeners, firstPage, rebuiltListeners, text, returnedPage, textAfterPendingUpload };
          } finally { view.destroy(); }
        };
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    logLevel: "silent",
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() =>
    (globalThis as any).runUploadLifecycle(),
  );
  expect.soft(result.unmountedListeners).toBe(0);
  expect
    .soft(result.firstPage)
    .toEqual({ text: "![[example.png]]page", writes: 1, listeners: 1 });
  expect.soft(result.rebuiltListeners).toBe(1);
  expect
    .soft(result.text)
    .toEqual({ text: "fn main() {}", writes: 1, listeners: 0 });
  expect
    .soft(result.returnedPage)
    .toEqual({ text: "![[example.png]]page", writes: 2, listeners: 1 });
  expect.soft(result.textAfterPendingUpload).toBe("fn main() {}");
});

test("page uploads respect configured maximum document size", async ({
  page,
}) => {
  const bundle = await build({
    stdin: {
      resolveDir: fileURLToPath(
        new URL("../../client/codemirror/", import.meta.url),
      ),
      contents: `
        import { EditorState } from "@codemirror/state";
        import { EditorView } from "@codemirror/view";
        import { documentExtension } from "./editor_paste.ts";

        globalThis.runUploadSizeLimit = async () => {
          let writes = 0;
          let notification;
          const client = {
            currentPath: () => "Example.md",
            config: { get: () => 0 },
            ui: {
              prompt: async () => "example.png",
              flashNotification: (message, type) => { notification = { message, type }; },
            },
            space: {
              spacePrimitives: { getFileMeta: async () => { throw new Error("missing"); } },
              writeDocument: async () => { writes++; },
            },
          };
          const view = new EditorView({
            state: EditorState.create({ doc: "page", extensions: documentExtension(client) }),
            parent: document.body,
          });
          client.editorView = view;
          const file = {
            name: "example.png",
            type: "image/png",
            arrayBuffer: async () => new Uint8Array([1]).buffer,
          };
          try {
            document.dispatchEvent(new CustomEvent("silverbullet:upload-files", { detail: { files: [file] } }));
            for (let i = 0; i < 10 && writes === 0 && notification === undefined; i++) {
              await new Promise(resolve => setTimeout(resolve, 10));
            }
            return { text: view.state.sliceDoc(), writes, notification };
          } finally {
            view.destroy();
          }
        };
      `,
    },
    bundle: true,
    write: false,
    format: "iife",
    logLevel: "silent",
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() =>
    (globalThis as any).runUploadSizeLimit(),
  );
  expect(result).toEqual({
    text: "page",
    writes: 0,
    notification: {
      message: "Document is too large, maximum is 0MiB",
      type: "error",
    },
  });
});

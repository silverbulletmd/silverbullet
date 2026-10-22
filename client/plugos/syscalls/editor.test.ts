import { expect, test, vi } from "vitest";
import type { Client } from "../../client.ts";
import { TEXT_DOCUMENT_LIMIT } from "../../document_editor_resolver.ts";
import { System } from "../system.ts";
import { editorSyscalls } from "./editor.ts";

test("registered document capability syscall resolves a mixed batch without body reads", async () => {
  const callback = async () => ({ html: "<p>Example</p>" });
  const readDocument = vi.fn(() => {
    throw new Error("capability resolution read a document body");
  });
  const client = {
    clientSystem: {
      documentEditorHook: {
        documentEditors: new Map([
          ["ExampleEditor", { extensions: ["custom"], callback }],
        ]),
      },
    },
    space: { readDocument },
  } as unknown as Client;
  const system = new System();
  system.registerSyscalls([], editorSyscalls(client));
  const documents = [
    {
      name: "drawing.custom",
      extension: "custom",
      contentType: "application/octet-stream",
      size: 100,
    },
    {
      name: "image.png",
      extension: "png",
      contentType: "image/png",
      size: 20_000_000,
    },
    {
      name: "source.rs",
      extension: "rs",
      contentType: "application/octet-stream",
      size: 100,
    },
    {
      name: "notes.unknown",
      extension: "unknown",
      contentType: "application/octet-stream",
      size: 100,
    },
    {
      name: "archive.zip",
      extension: "zip",
      contentType: "application/zip",
      size: 100,
    },
    {
      name: "huge.rs",
      extension: "rs",
      contentType: "text/rust",
      size: TEXT_DOCUMENT_LIMIT + 1,
    },
  ];
  const expected = [
    { kind: "plug", editor: "ExampleEditor" },
    { kind: "media" },
    { kind: "text", reason: undefined },
    { kind: "text", reason: "probe-required" },
    { kind: "external", reason: "binary" },
    { kind: "external", reason: "too-large" },
  ];

  await expect(
    system.localSyscall("editor.getDocumentCapabilities", [documents]),
  ).resolves.toEqual(expected);
  await expect(
    system.localSyscall("editor.getDocumentCapabilities", [documents]),
  ).resolves.toEqual(expected);
  expect(readDocument).not.toHaveBeenCalled();
});

test("download space file saves its current bytes under the file basename", async () => {
  const readFile = vi.fn(async () => ({
    data: new Uint8Array([0, 1, 255]),
    meta: { contentType: "application/pdf" },
  }));
  const link = { href: "", download: "", click: vi.fn() };
  vi.stubGlobal("document", { createElement: () => link });
  const objectUrl = vi
    .spyOn(URL, "createObjectURL")
    .mockReturnValue("blob:report");
  try {
    const client = {
      space: { spacePrimitives: { readFile } },
    } as unknown as Client;
    const system = new System();
    system.registerSyscalls([], editorSyscalls(client));
    await system.localSyscall("editor.downloadSpaceFile", ["Files/report.pdf"]);

    expect(readFile).toHaveBeenCalledWith("Files/report.pdf");
    expect(link.download).toBe("report.pdf");
    expect(link.href).toBe("blob:report");
    expect(link.click).toHaveBeenCalledOnce();
    const blob = objectUrl.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/pdf");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(
      new Uint8Array([0, 1, 255]),
    );
  } finally {
    objectUrl.mockRestore();
    vi.unstubAllGlobals();
  }
});

test("awaitRender reports whether the editor finished rendering in time", async () => {
  vi.stubGlobal("requestAnimationFrame", (callback: () => void) =>
    setTimeout(callback, 1),
  );
  let busy = true;
  const querySelector = vi.fn((selector: string) =>
    busy && selector.includes(".sb-loading-widget") ? {} : null,
  );
  try {
    const client = {
      widgetsReady: Promise.resolve(),
      editorView: { dom: { querySelector } },
    } as unknown as Client;
    const system = new System();
    system.registerSyscalls([], editorSyscalls(client));

    await expect(system.localSyscall("editor.awaitRender", [50])).resolves.toBe(
      false,
    );
    busy = false;
    await expect(system.localSyscall("editor.awaitRender", [])).resolves.toBe(
      true,
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

test("editor.prompt forwards the password option to the UI", async () => {
  const prompt = vi.fn(async () => "s3cret");
  const client = { ui: { prompt } } as unknown as Client;
  const system = new System();
  system.registerSyscalls([], editorSyscalls(client));

  await expect(
    system.localSyscall("editor.prompt", ["Key", "", { password: true }]),
  ).resolves.toBe("s3cret");
  expect(prompt).toHaveBeenCalledWith("Key", "", { password: true });
});

test("editor.chooseVersion forwards the options to the UI and returns its answer", async () => {
  const chooseVersion = vi.fn(async () => "keep-mine");
  const client = { ui: { chooseVersion } } as unknown as Client;
  const system = new System();
  system.registerSyscalls([], editorSyscalls(client));
  const options = {
    title: "Conflict",
    mine: "a\n",
    theirs: "b\n",
    choices: [{ id: "keep-mine", label: "Keep mine" }],
  };

  await expect(
    system.localSyscall("editor.chooseVersion", [options]),
  ).resolves.toBe("keep-mine");
  expect(chooseVersion).toHaveBeenCalledWith(options);
});

test("editor.chooseVersion takes an empty Lua table of choices as none", async () => {
  const chooseVersion = vi.fn(async () => undefined);
  const client = { ui: { chooseVersion } } as unknown as Client;
  const syscalls = editorSyscalls(client) as Record<string, any>;
  await syscalls["editor.chooseVersion"].callback(
    {},
    { title: "T", mine: "a", theirs: "b", choices: {} },
  );
  expect(chooseVersion).toHaveBeenCalledWith({
    title: "T",
    mine: "a",
    theirs: "b",
    choices: [],
  });
});

test("editor.pickMany forwards the options to the UI and returns its answer", async () => {
  const pickMany = vi.fn(async () => ["a"]);
  const client = { ui: { pickMany } } as unknown as Client;
  const system = new System();
  system.registerSyscalls([], editorSyscalls(client));
  const options = {
    title: "Remove?",
    items: [{ id: "a", label: "A" }],
  };

  await expect(
    system.localSyscall("editor.pickMany", [options]),
  ).resolves.toEqual(["a"]);
  expect(pickMany).toHaveBeenCalledWith(options);
});

test("editor.pickMany takes an empty Lua table of items as none", async () => {
  const pickMany = vi.fn(async () => undefined);
  const client = { ui: { pickMany } } as unknown as Client;
  const syscalls = editorSyscalls(client) as Record<string, any>;
  await syscalls["editor.pickMany"].callback({}, { title: "T", items: {} });
  expect(pickMany).toHaveBeenCalledWith({ title: "T", items: [] });
});

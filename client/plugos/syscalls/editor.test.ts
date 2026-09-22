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

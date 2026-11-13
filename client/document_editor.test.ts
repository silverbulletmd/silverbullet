// @vitest-environment happy-dom
import { expect, test, vi } from "vitest";
import type { Client } from "./client.ts";
import { IFrameDocumentEditor } from "./document_editor.ts";
import type { ThemeMessage } from "./space_theme.ts";

const night: ThemeMessage = {
  scheme: "dark",
  page: "Library/Paper/Night",
  css: "<style>html{--root-color:#eee}</style>",
};

test("updateTheme sends the scheme, the theme page and the theme's CSS", () => {
  const client = { spaceTheme: { message: night } } as unknown as Client;
  const editor = new IFrameDocumentEditor(document.body, client, () => {});
  editor.iframe = document.createElement("iframe");
  document.body.append(editor.iframe);
  const post = vi.spyOn(editor.iframe.contentWindow!, "postMessage");

  editor.updateTheme();

  expect(post).toHaveBeenCalledWith({
    type: "set-theme",
    internal: true,
    data: night,
  });
});

test("a new editor's iframe starts on the theme, its CSS included", () => {
  const { iframe } = (IFrameDocumentEditor as any).createIframe(
    {
      html: '<html><head><div id="sb-theme" hidden></div></head><body></body></html>',
    },
    night,
  );
  const doc = new DOMParser().parseFromString(iframe.srcdoc, "text/html");
  expect(doc.documentElement.dataset.sbScheme).toBe("dark");
  expect(doc.documentElement.dataset.sbTheme).toBe(night.page);
  expect(doc.getElementById("sb-theme")!.innerHTML).toBe(night.css);
});

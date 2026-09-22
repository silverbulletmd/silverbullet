import { Buffer } from "node:buffer";
import { createPageViaPagePicker } from "../fixtures/actions.ts";
import {
  expect,
  gotoSilverBulletPage,
  test,
  waitForEditorReady,
  waitForPersistedContent,
} from "../fixtures/core.ts";

const initialRust = [
  "fn main() {",
  '    let message = "ready";',
  '    println!("{message}");',
  "}",
].join("\n");
const savedRust = `${initialRust}\n// Saved from the document editor.\n`;

function pcmWavFixture(): Uint8Array {
  const samples = Uint8Array.from([32, 48, 64, 72, 64, 48, 32, 24]);
  const bytes = new Uint8Array(44 + samples.length);
  const view = new DataView(bytes.buffer);
  const ascii = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      bytes[offset + i] = value.charCodeAt(i);
    }
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 8000, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  ascii(36, "data");
  view.setUint32(40, samples.length, true);
  bytes.set(samples, 44);
  return bytes;
}

const toneWav = pcmWavFixture();
const toneFile = String.fromCharCode(...toneWav);

test.use({
  spaceFiles: {
    "index.md": "Document examples",
    "Return.md": "A Markdown page between document visits.\n",
    "Source/sample.rs": initialRust,
    "Audio/tone.wav": toneFile,
  },
});

test("a source document can be highlighted, edited, saved, and reopened", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Source/sample.rs");

  const editor = page.locator("#sb-editor .cm-content");
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('let message = "ready";');
  await expect(editor.locator(".sb-keyword", { hasText: "fn" })).toBeVisible();

  await page.evaluate(() => {
    const view = (globalThis as any).client.editorView;
    view.dispatch({ selection: { anchor: view.state.doc.length } });
    view.focus();
  });
  await page.keyboard.insertText("\n// Saved from the document editor.\n");
  await waitForPersistedContent(sbServer, "Source/sample.rs", savedRust);

  await gotoSilverBulletPage(page, sbServer, "Return");
  await expect(editor).toContainText(
    "A Markdown page between document visits.",
  );
  await gotoSilverBulletPage(page, sbServer, "Source/sample.rs");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis as any).client.editorView.state.doc.toString(),
      ),
    )
    .toBe(savedRust);
});

test("a missing text document can be created from the picker and edited", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "index");
  await createPageViaPagePicker(page, "Notes/new.txt");

  const editor = page.locator("#sb-editor .cm-content");
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.insertText("New document content");
  await waitForPersistedContent(
    sbServer,
    "Notes/new.txt",
    "New document content",
  );
});

test("a browser-supported audio document uses native controls and server ranges", async ({
  page,
  sbServer,
}) => {
  await page.goto(`${sbServer.url}/Audio/tone.wav?headless=1`);
  await waitForEditorReady(page);

  const audio = page.locator("#sb-editor .sb-media-viewer audio[controls]");
  await expect(audio).toBeVisible();
  await expect(audio).toHaveJSProperty("autoplay", false);

  const response = await page.request.get(
    `${sbServer.url}/.fs/Audio/tone.wav`,
    { headers: { Range: "bytes=0-15" } },
  );
  expect(response.status()).toBe(206);
  expect(response.headers()["content-range"]).toBe(
    `bytes 0-15/${toneWav.byteLength}`,
  );
  expect(await response.body()).toEqual(Buffer.from(toneWav.slice(0, 16)));
});

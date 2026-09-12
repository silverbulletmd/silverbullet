import { Buffer } from "node:buffer";
import type { Page } from "@playwright/test";
import { runCommandViaPalette } from "../fixtures/actions.ts";
import {
  expect,
  gotoSilverBulletPage,
  test,
  waitForPersistedContent,
} from "../fixtures/core.ts";

const pixelPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const binaryDocument = Buffer.from([0, 1, 2, 3, 127, 128, 254, 255]);

async function acceptUploadName(page: Page, path: string): Promise<void> {
  const prompt = page.locator(".sb-prompt");
  await expect(prompt).toContainText(
    /File name for (pasted|uploaded) document/,
  );
  const input = prompt.locator(".sb-prompt-input");
  await input.fill(path);
  await input.press("Enter");
}

test.use({ spaceFiles: { "Media.md": "# Media\n\n" } });

test("pasting an image writes its bytes and embeds it in the page", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Media");
  await page.locator("#sb-editor .cm-content").click();
  await page.evaluate(
    (bytes) => {
      const file = new File([new Uint8Array(bytes)], "pixel.png", {
        type: "image/png",
      });
      const clipboard = new DataTransfer();
      clipboard.items.add(file);
      const event = new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
      });
      Object.defineProperty(event, "clipboardData", { value: clipboard });
      document.querySelector("#sb-editor .cm-content")!.dispatchEvent(event);
    },
    [...pixelPng],
  );
  await acceptUploadName(page, "Assets/pixel.png");

  await waitForPersistedContent(
    sbServer,
    "Media.md",
    /!\[\[Assets\/pixel\.png\]\]/,
  );
  const response = await page.request.get(
    `${sbServer.url}/.fs/Assets/pixel.png`,
  );
  expect(response.ok()).toBe(true);
  expect(await response.body()).toEqual(pixelPng);
});

test("uploading a binary file writes exact bytes and links it", async ({
  page,
  sbServer,
}) => {
  await gotoSilverBulletPage(page, sbServer, "Media");
  await page.locator("#sb-editor .cm-content").click();

  const chooserPromise = page.waitForEvent("filechooser");
  await runCommandViaPalette(page, "Upload: File");
  const chooser = await chooserPromise;
  await chooser.setFiles({
    name: "payload.bin",
    mimeType: "application/octet-stream",
    buffer: binaryDocument,
  });
  await acceptUploadName(page, "Assets/payload.bin");

  await waitForPersistedContent(
    sbServer,
    "Media.md",
    /\[\[Assets\/payload\.bin\]\]/,
  );
  const response = await page.request.get(
    `${sbServer.url}/.fs/Assets/payload.bin`,
  );
  expect(response.ok()).toBe(true);
  expect(await response.body()).toEqual(binaryDocument);
});

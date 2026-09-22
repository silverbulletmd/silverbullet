import { waitForPersistedContent } from "../fixtures/core.ts";
import {
  expect,
  localContent,
  openLivePage,
  test,
} from "../fixtures/offline.ts";

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
    "index.md": "Offline notebook",
    "Draft.md": "Cached draft.\n",
    "Audio/tone.wav": toneFile,
  },
});
test.skip(
  ({ browserName }) => browserName !== "chromium",
  "Playwright offline service-worker emulation is validated in Chromium",
);

test("offline edits survive reload and are saved after reconnecting", async ({
  page,
  context,
  sbServer,
}) => {
  await openLivePage(page, sbServer.url, "Offline notebook");
  await context.setOffline(true);
  await page.goto(`${sbServer.url}/Draft`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".cm-content")).toContainText("Cached draft.");
  await page.locator(".cm-content").click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("Written offline.\n");
  const expected = "Cached draft.\nWritten offline.\n";
  await expect.poll(() => localContent(page, "Draft.md")).toBe(expected);
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(page.locator(".cm-content")).toContainText("Written offline.");
  await expect.poll(() => localContent(page, "Draft.md")).toBe(expected);
  await context.setOffline(false);
  await waitForPersistedContent(sbServer, "Draft.md", expected);
  await page.goto(`${sbServer.url}/Draft`);
  await expect(page.locator(".cm-content")).toContainText("Written offline.");
});

test("an unsynced document range is proxied through the service worker", async ({
  page,
  sbServer,
}) => {
  await openLivePage(page, sbServer.url, "Offline notebook");

  const result = await page.evaluate(async () => {
    const response = await fetch("/.fs/Audio/tone.wav", {
      headers: { Range: "bytes=0-15" },
      cache: "no-store",
    });
    return {
      status: response.status,
      contentRange: response.headers.get("Content-Range"),
      bytes: [...new Uint8Array(await response.arrayBuffer())],
    };
  });

  expect(result.status).toBe(206);
  expect(result.contentRange).toBe(`bytes 0-15/${toneWav.byteLength}`);
  expect(result.bytes).toEqual([...toneWav.slice(0, 16)]);
});

test.describe("with document syncing enabled", () => {
  test.use({
    spaceFiles: {
      "index.md": "Synced media notebook",
      "CONFIG.md": [
        "```space-lua",
        'config.set("sync.documents", true)',
        "```",
        "",
      ].join("\n"),
      "Audio/tone.wav": toneFile,
    },
  });

  test("an offline document range is served from local storage", async ({
    page,
    context,
    sbServer,
  }) => {
    await openLivePage(page, sbServer.url, "Synced media notebook");
    await context.setOffline(true);
    try {
      const result = await page.evaluate(async () => {
        const response = await fetch("/.fs/Audio/tone.wav", {
          headers: { Range: "bytes=0-15" },
          cache: "no-store",
        });
        return {
          status: response.status,
          contentRange: response.headers.get("Content-Range"),
          bytes: [...new Uint8Array(await response.arrayBuffer())],
        };
      });

      expect(result.status).toBe(206);
      expect(result.contentRange).toBe(`bytes 0-15/${toneWav.byteLength}`);
      expect(result.bytes).toEqual([...toneWav.slice(0, 16)]);
    } finally {
      await context.setOffline(false);
    }
  });
});

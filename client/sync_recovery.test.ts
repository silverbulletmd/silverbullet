import { afterEach, describe, expect, test, vi } from "vitest";
import type { Client } from "./client.ts";
import {
  decodeSafetyText,
  formatSafetyLabel,
  requestSafetyContent,
  requestSafetyList,
} from "./sync_recovery.ts";

function stubNeverRespondingServiceWorker() {
  vi.stubGlobal("navigator", {
    serviceWorker: {
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
}

function fakeClient(): Client {
  return { postServiceWorkerMessage: vi.fn() } as unknown as Client;
}

describe("decodeSafetyText", () => {
  test("decodes valid UTF-8 bytes", () => {
    const data = new TextEncoder().encode("hello world");
    expect(decodeSafetyText(data)).toBe("hello world");
  });

  test("returns null for non-decodable bytes", () => {
    const data = new Uint8Array([0xff, 0xfe, 0xfd]);
    expect(decodeSafetyText(data)).toBeNull();
  });
});

describe("formatSafetyLabel", () => {
  test("formats a text entry as ISO timestamp and size", () => {
    const label = formatSafetyLabel({
      hash: "abc",
      size: 42,
      ts: Date.parse("2026-08-19T12:00:00.000Z"),
      binary: false,
    });
    expect(label).toBe("2026-08-19T12:00:00.000Z · 42 bytes");
  });

  test("flags binary entries", () => {
    const label = formatSafetyLabel({
      hash: "abc",
      size: 42,
      ts: Date.parse("2026-08-19T12:00:00.000Z"),
      binary: true,
    });
    expect(label).toBe("2026-08-19T12:00:00.000Z · 42 bytes (binary)");
  });
});

describe("requestSafetyList/requestSafetyContent timeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  test("requestSafetyList resolves to undefined when the service worker never replies", async () => {
    vi.useFakeTimers();
    stubNeverRespondingServiceWorker();

    const resultPromise = requestSafetyList(fakeClient(), 3000);
    await vi.advanceTimersByTimeAsync(3000);

    expect(await resultPromise).toBeUndefined();
  });

  test("requestSafetyContent resolves to undefined when the service worker never replies", async () => {
    vi.useFakeTimers();
    stubNeverRespondingServiceWorker();

    const resultPromise = requestSafetyContent(fakeClient(), "somehash", 3000);
    await vi.advanceTimersByTimeAsync(3000);

    expect(await resultPromise).toBeUndefined();
  });
});

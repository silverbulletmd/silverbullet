import { afterEach, expect, test, vi } from "vitest";
import * as cryptoHelpers from "./crypto.ts";
import {
  decryptAesGcm,
  decryptStringDeterministic,
  deriveCTRKeyFromPassword,
  deriveGCMKeyFromCTR,
  encryptAesGcm,
  encryptStringDeterministic,
} from "@silverbulletmd/silverbullet/lib/crypto";

afterEach(() => vi.unstubAllGlobals());

test("SHA-256 retains its output without Web Crypto, including byte slices", async () => {
  const data = new TextEncoder().encode("prefix:Field notes 🌱:suffix");
  const slice = data.subarray(7, data.length - 7);
  const expected = await cryptoHelpers.hashSHA256(slice);
  vi.stubGlobal("crypto", {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
  expect(await cryptoHelpers.hashSHA256(slice)).toBe(expected);
  expect(await cryptoHelpers.hashSHA256("Field notes 🌱")).toBe(expected);
  expect(await cryptoHelpers.hashSHA256("")).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("UUIDs remain valid and distinct without randomUUID", () => {
  vi.stubGlobal("crypto", {
    getRandomValues: crypto.getRandomValues.bind(crypto),
  });
  const ids = Array.from({ length: 100 }, () => cryptoHelpers.randomUUID());
  expect(new Set(ids).size).toBe(ids.length);
  for (const id of ids)
    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
});

test("Crypto test", async () => {
  const salt = new Uint8Array(16); // zeroes for testing
  const ctr = await deriveCTRKeyFromPassword("12345", salt);
  const gcm = await deriveGCMKeyFromCTR(ctr);
  const text = "123";
  const encrypted = await encryptStringDeterministic(ctr, text);
  const encrypted2 = await encryptStringDeterministic(ctr, text);
  expect(encrypted).toEqual(encrypted2);
  const decrypted = await decryptStringDeterministic(ctr, encrypted);
  expect(decrypted).toEqual(text);

  const buffer = new Uint8Array(100).fill(32);
  const encryptedBuf = await encryptAesGcm(gcm, buffer);
  const decryptedBuf = await decryptAesGcm(gcm, encryptedBuf);
  expect(decryptedBuf).toEqual(buffer);
});

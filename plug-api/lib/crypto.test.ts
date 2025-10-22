import {
  decryptAesGcm,
  decryptStringDeterministic,
  deriveCTRKeyFromPassword,
  deriveGCMKeyFromCTR,
  encryptAesGcm,
  encryptStringDeterministic,
} from "@silverbulletmd/silverbullet/lib/crypto";
import { assertEquals } from "@std/assert";

Deno.test("Crypto test", async () => {
  const salt = new Uint8Array(16); // zeroes for testing
  const ctr = await deriveCTRKeyFromPassword("12345", salt);
  const gcm = await deriveGCMKeyFromCTR(ctr);
  const text = "123";
  const encrypted = await encryptStringDeterministic(ctr, text);
  const encrypted2 = await encryptStringDeterministic(ctr, text);
  // Ensure determinism
  assertEquals(encrypted, encrypted2);
  const decrypted = await decryptStringDeterministic(ctr, encrypted);
  assertEquals(decrypted, text);

  // Now gcm
  const buffer = new Uint8Array(100).fill(32);
  const encryptedBuf = await encryptAesGcm(gcm, buffer);
  const decryptedBuf = await decryptAesGcm(gcm, encryptedBuf);
  assertEquals(decryptedBuf, buffer);
});

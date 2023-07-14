import { assertEquals } from "../../test_deps.ts";
import {
  decryptAES,
  decryptPath,
  deriveKeyFromPassword,
  encryptAES,
  encryptPath,
} from "./aes.ts";

Deno.test("AES encryption and decryption", async () => {
  const password = "YourPassword";
  const salt = "UniquePerUserSalt";
  const message = "Hello, World!";

  const key = await deriveKeyFromPassword(password, salt);
  const encrypted = await encryptAES(key, message);

  const decrypted = await decryptAES(key, encrypted);
  assertEquals(decrypted, message);

  // Test that checks if a path is encrypted the same way every time and can be unencrypted
  const path =
    "this/is/a/long/path/that/needs/to/be/encrypted because that's what we do.md";
  const encryptedPath = await encryptPath(key, path);
  const encryptedPath2 = await encryptPath(key, path);
  // Assure two runs give the same result
  assertEquals(encryptedPath, encryptedPath2);

  // Ensure decryption works
  const decryptedPath = await decryptPath(key, encryptedPath);
  console.log(encryptedPath);
  assertEquals(decryptedPath, path);
});

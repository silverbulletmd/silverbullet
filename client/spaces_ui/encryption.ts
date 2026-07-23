/**
 * Client-encryption key handling for a space's login page.
 *
 * The key is derived in the browser from the credentials the user just typed
 * and handed to the service worker, which keeps it in memory only (see
 * `client/service_worker.ts`). It is deliberately never persisted: what
 * survives a reload is the `enableEncryption` flag, and the key itself is
 * re-fetched from whichever service worker still holds it (`boot.ts`'s
 * `findEncryptionKey`). Logging in again is what re-derives it.
 */

export function base64Encode(buffer: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < buffer.byteLength; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

export function base64Decode(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** PBKDF2(`username:password`, salt) → a raw AES-CTR key, base64-encoded. */
export async function deriveEncryptionKey(
  phrase: string,
  salt: Uint8Array<ArrayBuffer>,
): Promise<string> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(phrase),
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"],
  );
  const ctrKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    baseKey,
    { name: "AES-CTR", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  return base64Encode(
    new Uint8Array(await crypto.subtle.exportKey("raw", ctrKey)),
  );
}

/**
 * Hand the key to the service worker(s) that will need it.
 *
 * On an account-managed server one login covers every space, so the key goes
 * to every registration — a space opened later picks it up from whichever
 * worker still holds it. Otherwise only this space's own worker gets it.
 */
export async function publishEncryptionKey(
  key: string,
  accountManaged: boolean,
): Promise<boolean> {
  if (!navigator.serviceWorker) return false;
  const registrations = accountManaged
    ? await navigator.serviceWorker.getRegistrations()
    : [await navigator.serviceWorker.getRegistration(document.baseURI)].filter(
        (registration): registration is ServiceWorkerRegistration =>
          !!registration,
      );
  if (registrations.length === 0) return false;
  for (const registration of registrations) {
    registration.active?.postMessage({ type: "set-encryption-key", key });
  }
  return true;
}

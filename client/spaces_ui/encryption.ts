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

/** Resolve `promise`, or `undefined` if it takes longer than `ms`. */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  return Promise.race([
    promise,
    new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), ms),
    ),
  ]);
}

/**
 * Post the key to one worker and wait for it to say it has stored it.
 *
 * The acknowledgement is the point: the caller navigates away the moment this
 * resolves, and the worker stores the key asynchronously (it has to import it
 * first). A bare postMessage lets the navigation win, and the editor then
 * boots to "no key" and bounces back to the login page.
 */
function deliverKey(
  registration: ServiceWorkerRegistration,
  key: string,
  ms: number,
): Promise<boolean> {
  const worker = registration.active;
  if (!worker) return Promise.resolve(false);
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const settle = (delivered: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(delivered);
    };
    const timer = setTimeout(() => settle(false), ms);
    channel.port1.onmessage = () => settle(true);
    worker.postMessage({ type: "set-encryption-key", key }, [channel.port2]);
  });
}

/**
 * Hand the key to the service worker(s) that will need it, and report whether
 * the one serving this space actually took it.
 *
 * On an account-managed server one login covers every space, so the key goes
 * to every registration — a space opened later picks it up from whichever
 * worker still holds it. Only this space's own worker gates the result: a
 * sibling scope we are not about to open must not hold up the login.
 */
export async function publishEncryptionKey(
  key: string,
  accountManaged: boolean,
  ms = 10_000,
): Promise<boolean> {
  if (!navigator.serviceWorker) return false;

  // `ready` rather than `getRegistration()`: the login page registers its
  // worker on mount, so a quick submit — a password manager, or a test — can
  // arrive while that registration is still installing and its `active` is
  // still null. Posting to null silently does nothing, and the old code
  // reported success regardless.
  const own = await withTimeout(navigator.serviceWorker.ready, ms);
  if (!own) return false;

  if (accountManaged) {
    const all = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      all
        .filter((registration) => registration !== own)
        .map((registration) => deliverKey(registration, key, ms)),
    );
  }
  return await deliverKey(own, key, ms);
}

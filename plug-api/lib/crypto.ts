export function base64Decode(s: string): Uint8Array {
  const binString = atob(s);
  const len = binString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binString.charCodeAt(i);
  }
  return bytes;
}

export function base64Encode(buffer: Uint8Array | string): string {
  if (typeof buffer === "string") {
    buffer = new TextEncoder().encode(buffer);
  }
  let binary = "";
  const len = buffer.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(buffer[i]);
  }
  return btoa(binary);
}

export function base64EncodedDataUrl(
  mimeType: string,
  buffer: Uint8Array,
): string {
  return `data:${mimeType};base64,${base64Encode(buffer)}`;
}

export function base64DecodeDataUrl(dataUrl: string): Uint8Array {
  const b64Encoded = dataUrl.split(",", 2)[1];
  return base64Decode(b64Encoded);
}

/**
 * Perform sha256 hash using the browser's crypto APIs
 * Note: this will only work over HTTPS
 * @param message
 */
export async function hashSHA256(
  message: string | Uint8Array,
): Promise<string> {
  // Transform the string into an ArrayBuffer
  const encoder = new TextEncoder();
  const data: Uint8Array = typeof message === "string"
    ? encoder.encode(message)
    : message;

  // Generate the hash
  const hashBuffer = await globalThis.crypto.subtle.digest(
    "SHA-256",
    data as BufferSource,
  );

  // Transform the hash into a hex string
  return Array.from(new Uint8Array(hashBuffer)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

/**
 * To avoid database clashes based on space folder path name, base URLs and encryption keys we derive
 * a database name from a hash of all these combined together
 */
export async function deriveDbName(
  type: "data" | "files",
  spaceFolderPath: string,
  baseURI: string,
  encryptionKey?: CryptoKey,
): Promise<string> {
  let keyPart = "";
  if (encryptionKey) {
    keyPart = await exportKey(encryptionKey);
  }
  const spaceHash = await hashSHA256(
    `${spaceFolderPath}:${baseURI}:${keyPart}`,
  );
  return `sb_${type}_${spaceHash}`;
}

// Fixed counter for AES-CTR all zeroes, for determinism
const fixedCounter = new Uint8Array(16);

export async function encryptStringDeterministic(
  key: CryptoKey,
  clearText: string,
): Promise<string> {
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-CTR", counter: fixedCounter, length: fixedCounter.length * 8 },
    key,
    new TextEncoder().encode(clearText),
  );
  return base64Encode(new Uint8Array(encrypted));
}

export async function decryptStringDeterministic(
  key: CryptoKey,
  cipherText: string,
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-CTR", counter: fixedCounter, length: fixedCounter.length * 8 },
    key,
    base64Decode(cipherText) as BufferSource,
  );
  return new TextDecoder().decode(decrypted);
}

// Encrypt using AES-GCM with random IV; output = IV + ciphertext
export async function encryptAesGcm(
  key: CryptoKey,
  data: Uint8Array,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12)); // 96-bit IV recommended for GCM
  const encryptedBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    data as BufferSource,
  );
  const encrypted = new Uint8Array(encryptedBuffer);

  // Prepend IV to ciphertext
  const result = new Uint8Array(iv.length + encrypted.length);
  result.set(iv, 0);
  result.set(encrypted, iv.length);
  return result;
}

// Decrypt using AES-GCM assuming input format IV + ciphertext
export async function decryptAesGcm(
  key: CryptoKey,
  encryptedData: Uint8Array,
): Promise<Uint8Array> {
  const iv = encryptedData.slice(0, 12); // extract IV (first 12 bytes)
  const ciphertext = encryptedData.slice(12);
  const decryptedBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ciphertext,
  );
  return new Uint8Array(decryptedBuffer);
}

export async function deriveCTRKeyFromPassword(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  // Encode password to ArrayBuffer
  const passwordBytes = new TextEncoder().encode(password);

  // Import password as a CryptoKey
  const baseKey = await crypto.subtle.importKey(
    "raw",
    passwordBytes,
    { name: "PBKDF2" },
    false,
    ["deriveBits", "deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: 100000,
      hash: "SHA-256",
    },
    baseKey,
    {
      name: "AES-CTR",
      length: 256,
    },
    true, // extractable
    ["encrypt", "decrypt"],
  );
}

export function importKey(b64EncodedKey: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    base64Decode(b64EncodedKey) as BufferSource,
    { name: "AES-CTR" },
    true,
    ["encrypt", "decrypt"],
  );
}

export async function exportKey(ctrKey: CryptoKey): Promise<string> {
  const key = await crypto.subtle.exportKey("raw", ctrKey);
  return base64Encode(new Uint8Array(key));
}

export async function deriveGCMKeyFromCTR(
  ctrKey: CryptoKey,
): Promise<CryptoKey> {
  const rawKey = await crypto.subtle.exportKey("raw", ctrKey);
  return crypto.subtle.importKey(
    "raw",
    rawKey,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
}

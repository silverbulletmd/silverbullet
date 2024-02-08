export function simpleHash(s: string): number {
  let hash = 0,
    i,
    chr;
  if (s.length === 0) return hash;
  for (i = 0; i < s.length; i++) {
    chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0; // Convert to 32bit integer
  }
  return hash;
}

export function base32Encode(data: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let result = "";
  let bits = 0;
  let value = 0;
  for (const byte of data) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      result += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    result += alphabet[(value << (5 - bits)) & 31];
  }
  return result;
}

export function base32Decode(data: string): Uint8Array {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const result = new Uint8Array(Math.floor(data.length * 5 / 8));
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of data) {
    value = (value << 5) | alphabet.indexOf(char);
    bits += 5;
    if (bits >= 8) {
      result[index++] = (value >>> (bits - 8)) & 255;
      bits -= 8;
    }
  }
  return result;
}

export async function deriveKeyFromPassword(
  salt: Uint8Array,
  password: string,
): Promise<CryptoKey> {
  const baseKey = new TextEncoder().encode(password);
  const importedKey = await window.crypto.subtle.importKey(
    "raw",
    baseKey,
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 10000,
      hash: "SHA-256",
    },
    importedKey,
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypts using AES-GCM and prepends the IV to the ciphertext
 * @param key
 * @param message
 * @returns
 */
export async function encryptAES(
  key: CryptoKey,
  message: Uint8Array,
): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    message,
  );
  return appendBuffer(iv, new Uint8Array(ciphertext));
}

/**
 * Decrypts using AES-GCM and expects the IV to be prepended to the ciphertext
 * @param key
 * @param data
 * @returns
 */
export async function decryptAES(
  key: CryptoKey,
  data: Uint8Array,
): Promise<Uint8Array> {
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    ciphertext,
  );
  return new Uint8Array(decrypted);
}

export function generateSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

export async function exportKey(key: CryptoKey): Promise<Uint8Array> {
  const arrayBuffer = await window.crypto.subtle.exportKey("raw", key);
  return new Uint8Array(arrayBuffer);
}

export function importKey(key: Uint8Array): Promise<CryptoKey> {
  return window.crypto.subtle.importKey(
    "raw",
    key,
    { name: "AES-GCM" },
    true,
    ["encrypt", "decrypt"],
  );
}

function appendBuffer(buffer1: Uint8Array, buffer2: Uint8Array): Uint8Array {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp;
}

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

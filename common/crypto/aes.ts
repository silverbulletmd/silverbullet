const encoder = new TextEncoder();
const decoder = new TextDecoder();

// This is against security recommendations, but we need a way to consistently encrypt and decrypt from the same password, and this needs to be transferrable between servers
const salt = new Uint8Array(12); // 12 bytes of 0

export function generateKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"],
  );
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

export async function deriveKeyFromPassword(
  password: string,
): Promise<CryptoKey> {
  const baseKey = encoder.encode(password);
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
      salt: salt,
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

function appendBuffer(buffer1: Uint8Array, buffer2: Uint8Array): Uint8Array {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp;
}

// Paths are encrypted using AES-GCM, base32 encoded, injecting a slash after the fifth character to avoid generating too many files in a folder
export async function encryptPath(
  key: CryptoKey,
  path: string,
): Promise<string> {
  const encodedMessage = encoder.encode(path);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: salt,
    },
    key,
    encodedMessage,
  );
  const encodedPath = base32Encode(new Uint8Array(ciphertext));
  return encodedPath.slice(0, 5) + "/" + encodedPath.slice(5);
}

function base32Encode(data: Uint8Array): string {
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

function base32Decode(data: string): Uint8Array {
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

export async function decryptPath(
  key: CryptoKey,
  encryptedPath: string,
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: salt,
    },
    key,
    // Strip out all slashes
    base32Decode(encryptedPath.replaceAll("/", "")),
  );
  return decoder.decode(decrypted);
}

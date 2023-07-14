import {
  base64Decode,
  base64Encode,
} from "../../plugos/asset_bundle/base64.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function deriveKeyFromPassword(
  password: string,
  salt: string,
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
      salt: encoder.encode(salt),
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
  message: string,
): Promise<ArrayBuffer> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encodedMessage = encoder.encode(message);
  const ciphertext = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    encodedMessage,
  );
  return appendBuffer(iv, ciphertext);
}

export async function decryptAES(
  key: CryptoKey,
  data: ArrayBuffer,
): Promise<string> {
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
  return decoder.decode(decrypted);
}

function appendBuffer(buffer1: ArrayBuffer, buffer2: ArrayBuffer): ArrayBuffer {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp.buffer;
}

// This is against security recommendations, but we need a way to always generate the same encrypted path for the same path and password
const pathIv = new Uint8Array(12); // 12 bytes of 0

export async function encryptPath(
  key: CryptoKey,
  path: string,
): Promise<string> {
  const encodedMessage = encoder.encode(path);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: pathIv,
    },
    key,
    encodedMessage,
  );
  return base64Encode(new Uint8Array(ciphertext));
}

export async function decryptPath(
  key: CryptoKey,
  data: string,
): Promise<string> {
  const decrypted = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: pathIv,
    },
    key,
    base64Decode(data),
  );
  return decoder.decode(decrypted);
}

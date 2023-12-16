import { FileMeta } from "../../plug-api/types.ts";
import { SpacePrimitives } from "./space_primitives.ts";

export const encryptedFileExt = ".crypt";
export const keyPath = "KEY";
export const saltFile = "salt.crypt";

/**
 * This class adds an (AES) based encryption layer on top of another SpacePrimitives implementation.
 * It encrypts all file names and file contents.
 * It uses a key file (default named _KEY) to store the encryption key, this file is encrypted with a key derived from the user's password.
 * The reason to keep the actualy encryption key in a file is to allow the user to change their password without having to re-encrypt all files.
 * Important note: FileMeta's size will reflect the underlying encrypted size, not the original size
 */
export class EncryptedSpacePrimitives implements SpacePrimitives {
  private masterKey?: CryptoKey;
  private encryptedKeyFileName?: string;
  spaceSalt?: Uint8Array;

  constructor(
    private wrapped: SpacePrimitives,
  ) {
  }

  /**
   * Checks if the space is initialized by loading the salt file.
   * @returns true if the space was initialized, false if it was not initialized yet
   */
  async init(salt?: Uint8Array | undefined | null): Promise<boolean> {
    if (salt) {
      this.spaceSalt = salt;
      return true;
    }
    try {
      this.spaceSalt = (await this.wrapped.readFile(saltFile)).data;
      return true;
    } catch (e: any) {
      if (e.message === "Not found") {
        console.warn("Space not initialized");
        return false;
      }
      throw e;
    }
  }

  /**
   * Setup a fresh space with a new salt and master encryption key derived from a password
   * @param password
   */
  async setup(password: string): Promise<void> {
    if (this.spaceSalt) {
      throw new Error("Space already initialized");
    }
    this.spaceSalt = this.generateSalt();
    await this.wrapped.writeFile(saltFile, this.spaceSalt);
    await this.createKey(password);
  }

  /**
   * Loads the encryption key from the master key based on the user's password
   * @param password the user's password
   */
  async login(password: string): Promise<void> {
    if (!this.spaceSalt) {
      throw new Error("Space not initialized");
    }
    // First derive an encryption key solely used for encrypting the key file from the user's password
    const keyEncryptionKey = await this.deriveKeyFromPassword(password);
    const encryptedKeyFileName = await this.encryptPath(
      keyEncryptionKey,
      keyPath,
    );

    try {
      this.masterKey = await this.importKey(
        await this.decryptAES(
          keyEncryptionKey,
          (await this.wrapped.readFile(
            encryptedKeyFileName,
          )).data,
        ),
      );
      this.encryptedKeyFileName = encryptedKeyFileName;
    } catch (e: any) {
      if (e.message === "Not found") {
        throw new Error("Incorrect password");
      }
      console.trace();
      throw e;
    }
  }

  private generateKey(): Promise<CryptoKey> {
    return window.crypto.subtle.generateKey(
      {
        name: "AES-GCM",
        length: 256,
      },
      true,
      ["encrypt", "decrypt"],
    );
  }

  private async createKey(password: string): Promise<void> {
    const keyEncryptionKey = await this.deriveKeyFromPassword(password);
    this.encryptedKeyFileName = await this.encryptPath(
      keyEncryptionKey,
      keyPath,
    );
    this.masterKey = await this.generateKey();
    // And write it
    await this.wrapped.writeFile(
      this.encryptedKeyFileName,
      await this.encryptAES(
        keyEncryptionKey,
        await this.exportKey(this.masterKey),
      ),
    );
  }

  async updatePassword(oldPassword: string, newPasword: string): Promise<void> {
    if (!this.masterKey) {
      throw new Error("No key loaded");
    }
    const oldPasswordKeyFileName = await this.encryptPath(
      await this.deriveKeyFromPassword(oldPassword),
      keyPath,
    );

    // Check if the old password is correct
    try {
      await this.wrapped.getFileMeta(oldPasswordKeyFileName);
    } catch (e: any) {
      if (e.message === "Not found") {
        throw new Error("Incorrect password");
      } else {
        throw e;
      }
    }

    // First derive an encryption key solely used for encrypting the key file from the user's password
    const keyEncryptionKey = await this.deriveKeyFromPassword(newPasword);

    this.encryptedKeyFileName = await this.encryptPath(
      keyEncryptionKey,
      keyPath,
    );
    // And write it
    await this.wrapped.writeFile(
      this.encryptedKeyFileName,
      await this.encryptAES(
        keyEncryptionKey,
        await this.exportKey(this.masterKey),
      ),
    );

    // Then delete the old key file based on the old password
    await this.wrapped.deleteFile(oldPasswordKeyFileName);
  }

  isUnencryptedPath(name: string) {
    return name.startsWith("_plug/");
  }

  private generateSalt(): Uint8Array {
    return crypto.getRandomValues(new Uint8Array(16));
  }

  private async exportKey(key: CryptoKey): Promise<Uint8Array> {
    const arrayBuffer = await window.crypto.subtle.exportKey("raw", key);
    return new Uint8Array(arrayBuffer);
  }

  private importKey(key: Uint8Array): Promise<CryptoKey> {
    return window.crypto.subtle.importKey(
      "raw",
      key,
      { name: "AES-GCM" },
      true,
      ["encrypt", "decrypt"],
    );
  }

  private async deriveKeyFromPassword(
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
        salt: this.spaceSalt!,
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
  private async encryptAES(
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
  async decryptAES(
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

  /**
   * Left pads a string with zeros to a length of 32, encrypts it using AES-GCM and returns the base32 encoded ciphertext
   * @param key
   * @param path
   * @returns
   */
  async encryptPath(
    key: CryptoKey,
    path: string,
  ): Promise<string> {
    if (!this.spaceSalt) {
      throw new Error("Space not initialized");
    }
    if (this.isUnencryptedPath(path)) {
      return path;
    }

    path = path.padEnd(32, "\0");
    const encodedMessage = new TextEncoder().encode(path);

    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: this.spaceSalt,
      },
      key,
      encodedMessage,
    );
    const encodedPath = base32Encode(new Uint8Array(ciphertext));
    // console.log(new TextDecoder().decode(ciphertext));
    return encodedPath.slice(0, 3) + "/" + encodedPath.slice(3) +
      encryptedFileExt;
  }

  private async decryptPath(
    key: CryptoKey,
    encryptedPath: string,
  ): Promise<string> {
    if (!this.spaceSalt) {
      throw new Error("Space not initialized");
    }
    if (this.isUnencryptedPath(encryptedPath)) {
      return encryptedPath;
    }

    if (!encryptedPath.endsWith(encryptedFileExt)) {
      throw new Error("Invalid encrypted path");
    }
    // Remove the extension and slashes
    encryptedPath = encryptedPath.slice(0, -encryptedFileExt.length).replaceAll(
      "/",
      "",
    );

    // console.log("To decrypt", encryptedPath);
    const decrypted = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: this.spaceSalt,
      },
      key,
      base32Decode(encryptedPath),
    );
    // Decode the buffer and remove the padding
    return removePadding(new TextDecoder().decode(decrypted), "\0");
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const files = await this.wrapped.fetchFileList();
    // console.log(files);
    return Promise.all(
      files.filter((fileMeta) =>
        fileMeta.name !== this.encryptedKeyFileName &&
        fileMeta.name !== saltFile
      )
        .map(async (fileMeta) => {
          return {
            ...fileMeta,
            name: await this.decryptPath(this.masterKey!, fileMeta.name),
          };
        }),
    );
  }

  async getFileMeta(name: string): Promise<FileMeta> {
    if (this.isUnencryptedPath(name)) {
      return this.wrapped.getFileMeta(name);
    }
    const fileMeta = await this.wrapped.getFileMeta(
      await this.encryptPath(this.masterKey!, name),
    );
    return {
      ...fileMeta,
      name,
    };
  }

  async readFile(name: string): Promise<{ data: Uint8Array; meta: FileMeta }> {
    if (this.isUnencryptedPath(name)) {
      return this.wrapped.readFile(name);
    }
    const { data, meta } = await this.wrapped.readFile(
      await this.encryptPath(this.masterKey!, name),
    );
    return {
      data: await this.decryptAES(this.masterKey!, data),
      meta: {
        ...meta,
        name,
      },
    };
  }

  async writeFile(
    name: string,
    data: Uint8Array,
    selfUpdate?: boolean | undefined,
    meta?: FileMeta | undefined,
  ): Promise<FileMeta> {
    if (this.isUnencryptedPath(name)) {
      return this.wrapped.writeFile(name, data, selfUpdate, meta);
    }
    const newMeta = await this.wrapped.writeFile(
      await this.encryptPath(this.masterKey!, name),
      await this.encryptAES(this.masterKey!, data),
      selfUpdate,
      meta,
    );
    return {
      ...newMeta,
      name,
    };
  }

  async deleteFile(name: string): Promise<void> {
    if (this.isUnencryptedPath(name)) {
      return this.wrapped.deleteFile(name);
    }
    return this.wrapped.deleteFile(
      await this.encryptPath(this.masterKey!, name),
    );
  }
}

function removePadding(str: string, paddingChar: string): string {
  // let startIndex = 0;
  // while (startIndex < str.length && str[startIndex] === paddingChar) {
  //   startIndex++;
  // }
  // return str.substring(startIndex);
  let endIndex = str.length - 1;
  while (endIndex >= 0 && str[endIndex] === paddingChar) {
    endIndex--;
  }
  return str.substring(0, endIndex + 1);
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

function appendBuffer(buffer1: Uint8Array, buffer2: Uint8Array): Uint8Array {
  const tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
  tmp.set(new Uint8Array(buffer1), 0);
  tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
  return tmp;
}

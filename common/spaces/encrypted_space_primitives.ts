import { FileMeta } from "../../plug-api/types.ts";
import {
  decryptPath,
  deriveKeyFromPassword,
  encryptAES,
  encryptPath,
  exportKey,
  generateKey,
  importKey,
} from "../crypto/aes.ts";
import { decryptAES } from "../crypto/aes.ts";
import { SpacePrimitives } from "./space_primitives.ts";

export const encryptedFileExt = ".encrypted";

/**
 * This class adds an (AES) based encryption layer on top of another SpacePrimitives implementation.
 * It encrypts all file names and file contents.
 * It uses a key file (default named _KEY) to store the encryption key, this file is encrypted with a key derived from the user's password.
 * The reason to keep the actualy encryption key in a file is to allow the user to change their password without having to re-encrypt all files.
 * Important note: FileMeta's size will reflect the underlying encrypted size, not the original size
 */
export class EncryptedSpacePrimitives implements SpacePrimitives {
  private key?: CryptoKey;
  private encryptedKeyFileName?: string;

  constructor(
    private wrapped: SpacePrimitives,
    private keyFile: string = "_KEY",
  ) {
  }

  /**
   * Loads the encryption key from the key file, or generates one if none exists yet.
   * @param password the user's password
   */
  async loadKey(password: string): Promise<void> {
    // First derive an encryption key solely used for encrypting the key file from the user's password
    const keyEncryptionKey = await deriveKeyFromPassword(password);
    const encryptedKeyFileName = await encryptPath(
      keyEncryptionKey,
      this.keyFile,
    ) + encryptedFileExt;

    try {
      this.key = await importKey(
        await decryptAES(
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

  async createKey(password: string): Promise<void> {
    const keyEncryptionKey = await deriveKeyFromPassword(password);
    this.encryptedKeyFileName = await encryptPath(
      keyEncryptionKey,
      this.keyFile,
    ) + encryptedFileExt;
    this.key = await generateKey();
    // And write it
    await this.wrapped.writeFile(
      this.encryptedKeyFileName,
      await encryptAES(keyEncryptionKey, await exportKey(this.key)),
    );
  }

  async updatePassword(oldPassword: string, newPasword: string): Promise<void> {
    if (!this.key) {
      throw new Error("No key loaded");
    }
    const oldPasswordKeyFileName = await encryptPath(
      await deriveKeyFromPassword(oldPassword),
      this.keyFile,
    ) + encryptedFileExt;

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
    const keyEncryptionKey = await deriveKeyFromPassword(newPasword);

    this.encryptedKeyFileName = await encryptPath(
      keyEncryptionKey,
      this.keyFile,
    ) + encryptedFileExt;
    // And write it
    await this.wrapped.writeFile(
      this.encryptedKeyFileName,
      await encryptAES(keyEncryptionKey, await exportKey(this.key)),
    );

    // Then delete the old key file based on the old password
    await this.wrapped.deleteFile(oldPasswordKeyFileName);
  }

  isUnencryptedPath(name: string) {
    return name.startsWith("_plug/");
  }

  async encryptPath(name: string): Promise<string> {
    if (this.isUnencryptedPath(name)) {
      return name;
    }
    const p = await encryptPath(this.key!, name);
    return p + encryptedFileExt;
  }

  async decryptPath(name: string): Promise<string> {
    if (this.isUnencryptedPath(name)) {
      return name;
    }
    if (!name.endsWith(encryptedFileExt)) {
      throw new Error(`Invalid encrypted file name: ${name}`);
    }
    return (await decryptPath(
      this.key!,
      name.slice(
        0,
        -encryptedFileExt.length,
      ),
    ));
  }

  async fetchFileList(): Promise<FileMeta[]> {
    const files = await this.wrapped.fetchFileList();
    return Promise.all(
      files.filter((fileMeta) => fileMeta.name !== this.encryptedKeyFileName)
        .map(async (fileMeta) => {
          return {
            ...fileMeta,
            name: await this.decryptPath(fileMeta.name),
          };
        }),
    );
  }
  async getFileMeta(name: string): Promise<FileMeta> {
    if (this.isUnencryptedPath(name)) {
      return this.wrapped.getFileMeta(name);
    }
    const fileMeta = await this.wrapped.getFileMeta(
      await this.encryptPath(name),
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
      await this.encryptPath(name),
    );
    return {
      data: await decryptAES(this.key!, data),
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
      await this.encryptPath(name),
      await encryptAES(this.key!, data),
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
    return this.wrapped.deleteFile(await this.encryptPath(name));
  }
}

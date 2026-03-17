import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createCipheriv,
  createDecipheriv,
  pbkdf2Sync,
  randomBytes,
} from "node:crypto";
import { hostname, userInfo } from "node:os";

export type SpaceConfig = {
  name: string;
  url: string;
  authType: "token" | "password" | "none";
  encryptedToken?: string;
  username?: string;
  encryptedPassword?: string;
};

type ConfigFile = {
  spaces: SpaceConfig[];
};

function deriveKey(): Buffer {
  const material = `${hostname()}${userInfo().username}silverbullet-cli`;
  return pbkdf2Sync(material, "silverbullet-cli-salt", 100000, 32, "sha256");
}

export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Format: iv:tag:ciphertext (all base64)
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decrypt(encoded: string): string {
  const key = deriveKey();
  const [ivB64, tagB64, dataB64] = encoded.split(":");
  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const data = Buffer.from(dataB64, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return decipher.update(data) + decipher.final("utf8");
}

function configDir(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

function configPath(): string {
  return join(configDir(), "silverbullet.json");
}

export async function readConfig(): Promise<ConfigFile> {
  try {
    const raw = await readFile(configPath(), "utf8");
    return JSON.parse(raw) as ConfigFile;
  } catch {
    return { spaces: [] };
  }
}

export async function writeConfig(config: ConfigFile): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true });
  await writeFile(
    configPath(),
    `${JSON.stringify(config, null, 2)}\n`,
  );
}

export function getSpace(
  config: ConfigFile,
  name?: string,
): SpaceConfig | undefined {
  if (name) {
    return config.spaces.find((s) => s.name === name);
  }
  if (config.spaces.length === 1) {
    return config.spaces[0];
  }
  return undefined;
}

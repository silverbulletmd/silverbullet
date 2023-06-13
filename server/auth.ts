import { KVStore } from "../plugos/lib/kv_store.ts";

export type User = {
  username: string;
  passwordHash: string; // hashed password
  salt: string;
  groups: string[]; // special "admin"
};

async function createUser(
  username: string,
  password: string,
  groups: string[],
  salt = generateSalt(16),
): Promise<User> {
  return {
    username,
    passwordHash: await hashSHA256(`${salt}${password}`),
    salt,
    groups,
  };
}

const userPrefix = `u:`;

export class Authenticator {
  constructor(private store: KVStore) {
  }

  async register(
    username: string,
    password: string,
    groups: string[],
    salt?: string,
  ): Promise<void> {
    await this.store.set(
      `${userPrefix}${username}`,
      await createUser(username, password, groups, salt),
    );
  }

  async authenticateHashed(
    username: string,
    hashedPassword: string,
  ): Promise<boolean> {
    const user = await this.store.get(`${userPrefix}${username}`) as User;
    if (!user) {
      return false;
    }
    return user.passwordHash === hashedPassword;
  }

  async authenticate(
    username: string,
    password: string,
  ): Promise<string | undefined> {
    const user = await this.store.get(`${userPrefix}${username}`) as User;
    if (!user) {
      return undefined;
    }
    const hashedPassword = await hashSHA256(`${user.salt}${password}`);
    return user.passwordHash === hashedPassword ? hashedPassword : undefined;
  }

  async getAllUsers(): Promise<User[]> {
    return (await this.store.queryPrefix(userPrefix)).map((item) => item.value);
  }

  getUser(username: string): Promise<User | undefined> {
    return this.store.get(`${userPrefix}${username}`);
  }

  async setPassword(username: string, password: string): Promise<void> {
    const user = await this.getUser(username);
    if (!user) {
      throw new Error(`User does not exist`);
    }
    user.passwordHash = await hashSHA256(`${user.salt}${password}`);
    await this.store.set(`${userPrefix}${username}`, user);
  }

  async deleteUser(username: string): Promise<void> {
    const user = await this.getUser(username);
    if (!user) {
      throw new Error(`User does not exist`);
    }
    await this.store.del(`${userPrefix}${username}`);
  }

  async setGroups(username: string, groups: string[]): Promise<void> {
    const user = await this.getUser(username);
    if (!user) {
      throw new Error(`User does not exist`);
    }
    user.groups = groups;
    await this.store.set(`${userPrefix}${username}`, user);
  }
}

async function hashSHA256(message: string): Promise<string> {
  // Transform the string into an ArrayBuffer
  const encoder = new TextEncoder();
  const data = encoder.encode(message);

  // Generate the hash
  const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);

  // Transform the hash into a hex string
  return Array.from(new Uint8Array(hashBuffer)).map((b) =>
    b.toString(16).padStart(2, "0")
  ).join("");
}

function generateSalt(length: number): string {
  const array = new Uint8Array(length / 2); // because two characters represent one byte in hex
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => ("00" + byte.toString(16)).slice(-2)).join(
    "",
  );
}
